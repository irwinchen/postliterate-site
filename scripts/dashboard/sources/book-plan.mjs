/**
 * book-plan.mjs — Writing plan source for the dashboard "Today" panel.
 *
 * Reads scripts/dashboard/book-plan.json (the hand-editable plan) and computes
 * what to do *today*: which week of the schedule we're in, whether today is a
 * drafting day (Mon–Thu), a review day (Fri), a weekend, before the start, or
 * past the end — and the matching block list + chapter target + reading focus.
 *
 * No new dependencies — Node built-ins only. No vault dependency; the plan is
 * repo-local config.
 *
 * Output shape (consumed by renderToday() in admin-ui.html):
 *   {
 *     target, role, cadence, sample_chapters, guardrails,
 *     phase: 'preflight'|'draft'|'review'|'weekend'|'wrapup',
 *     today:  { iso, weekday, label },
 *     blocks: [ { n, hours, title, kind, body } ],   // [] on weekend/wrapup
 *     week:   { n, start, end, draft, draft_label, reading } | null,
 *     next_week: { ... } | null,
 *     weeks_total, weeks: [ ... ]                     // full schedule for the table
 *   }
 */

import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { getDailyPrompt } from '../lib/book-prompt.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLAN_PATH = join(__dirname, '..', 'book-plan.json');
const VAULT = process.env.VAULT_PATH || join(homedir(), 'vaults/PostLiterate');
const CHAPTERS_DIR = join(VAULT, '03_Chapters');
const DRAFT_WORDS_PATH = process.env.DRAFT_WORDS_PATH || join(__dirname, '..', 'snapshots', 'draft-words.json');

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function todayIso(now = new Date()) {
  // Local-date ISO (YYYY-MM-DD), not UTC — the plan is anchored to the
  // author's local week.
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function weekdayIndex(iso) {
  // Noon avoids any TZ/DST edge flipping the date.
  return new Date(`${iso}T12:00:00`).getDay(); // 0=Sun … 6=Sat
}

function prevIso(iso) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Count prose words only: strip YAML frontmatter, HTML comments, and markdown
// heading lines (the scaffolding), then count whitespace tokens. Keeps the
// count honest about *written prose*, not the section skeleton.
function countProseWords(text) {
  let t = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  t = t.replace(/<!--[\s\S]*?-->/g, ' ');
  t = t
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l))
    .join(' ');
  return t.trim().split(/\s+/).filter(Boolean).length;
}

function frontmatterNum(text, key) {
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return null;
  const m = fm[1].match(new RegExp('^' + key + '\\s*:\\s*(\\d+)', 'm'));
  return m ? Number(m[1]) : null;
}

// Recursively collect every *.md under dir, returning full paths.
function listMarkdown(dir) {
  let out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(listMarkdown(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

// Word counts across the whole 03_Chapters folder. `total` is the sum of prose
// words in *every* .md file under 03_Chapters (any chapter, section, or draft),
// so "words today" captures writing anywhere in the folder. Tracks per-week and
// daily baselines (snapshots/draft-words.json) so `this_week` / `today` = words
// added since each window began. Also returns one progress entry per sample
// chapter for the activity rings.
function getDraftWords(activeWeek, phase, opts = {}) {
  const { weeks = [], iso = null, dailyGoal = 600, seedDay = null } = opts;
  let files; // [{ rel, words, target }] — rel is the path within 03_Chapters
  try {
    if (!existsSync(CHAPTERS_DIR)) return null;
    files = listMarkdown(CHAPTERS_DIR)
      .map((full) => {
        const text = readFileSync(full, 'utf8');
        return {
          rel: full.slice(CHAPTERS_DIR.length + 1),
          words: countProseWords(text),
          target: frontmatterNum(text, 'word_target'),
        };
      })
      .sort((a, b) => a.rel.localeCompare(b.rel));
  } catch {
    return null;
  }
  const total = files.reduce((s, x) => s + x.words, 0);

  // One ring per sample chapter (the plan's draft_file targets). Introduction
  // leads, then the numbered chapters in order (Ch.2 → Ch.4 → Ch.5). Files that
  // don't exist yet read as 0 words so the ring is present from the start.
  const chapters = [];
  const seenCh = new Set();
  for (const wk of weeks) {
    const f = wk.draft_file;
    if (!f || !f.startsWith('03_Chapters/') || seenCh.has(f)) continue;
    seenCh.add(f);
    const rel = f.slice('03_Chapters/'.length);
    const base = rel.split('/').pop();
    const hit = files.find((x) => x.rel === rel);
    chapters.push({
      label: wk.draft || base,
      title: base.replace(/\.draft\.md$/, '').replace(/\.md$/, '').replace(/^\d+[_ ]+/, '').trim(),
      file: f,
      words: hit ? hit.words : 0,
      target: (hit && hit.target) || 2000,
    });
  }
  // Introduction (no numeric filename prefix) first, then numbered chapters.
  chapters.sort((a, b) => {
    const an = /^\d/.test(a.file.split('/').pop());
    const bn = /^\d/.test(b.file.split('/').pop());
    if (an !== bn) return an ? 1 : -1;
    return a.file.localeCompare(b.file);
  });

  // Daily writing history (snapshots/draft-words.json → `history` map keyed by
  // ISO date, each { start, end } of the 03_Chapters prose total). `today` is
  // today's delta; `this_week` is the plan-week delta. History is tracked in
  // every phase (writing happens before the plan formally starts); the weekly
  // baseline only snaps once the plan is running.
  let this_week = 0;
  let today = 0;
  let history = [];
  try {
    let state = {};
    if (existsSync(DRAFT_WORDS_PATH)) state = JSON.parse(readFileSync(DRAFT_WORDS_PATH, 'utf8'));
    state.week_baselines = state.week_baselines || {};
    state.history = state.history || {};
    delete state.day_baselines; // superseded by `history`
    let dirty = false;

    // First-ever run: anchor the series at seedDay (yesterday) with the current
    // total, so the chart starts there and real per-day counts accrue forward.
    if (seedDay && Object.keys(state.history).length === 0) {
      state.history[seedDay] = { start: total, end: total };
      dirty = true;
    }
    if (iso) {
      if (state.history[iso] === undefined) {
        state.history[iso] = { start: total, end: total };
        dirty = true;
      } else if (state.history[iso].end !== total) {
        state.history[iso].end = total;
        dirty = true;
      }
      today = Math.max(0, state.history[iso].end - state.history[iso].start);
      // Keep the series bounded (~4 months).
      const days = Object.keys(state.history).sort();
      while (days.length > 120) { delete state.history[days.shift()]; dirty = true; }
    }
    if (phase !== 'preflight' && activeWeek) {
      if (state.week_baselines[activeWeek.start] === undefined) {
        state.week_baselines[activeWeek.start] = total;
        dirty = true;
      }
      this_week = total - state.week_baselines[activeWeek.start];
    }
    if (dirty) writeFileSync(DRAFT_WORDS_PATH, JSON.stringify(state, null, 2), 'utf8');

    history = Object.keys(state.history).sort().map((d) => ({
      date: d,
      words: Math.max(0, (state.history[d].end || 0) - (state.history[d].start || 0)),
    }));
  } catch {
    this_week = 0;
    today = 0;
    history = [];
  }

  return { total, this_week, today, daily_goal: dailyGoal, chapters, history };
}

export async function getBookPlan(now = new Date()) {
  if (!existsSync(PLAN_PATH)) {
    return { error: 'book-plan.json not found', weeks: [], blocks: [] };
  }

  const plan = JSON.parse(readFileSync(PLAN_PATH, 'utf8'));
  const weeks = Array.isArray(plan.weeks) ? plan.weeks : [];
  const iso = todayIso(now);
  const dow = weekdayIndex(iso);
  const dailyGoal = plan.daily_word_goal || 600;
  const dwOpts = { weeks, iso, dailyGoal, seedDay: prevIso(iso) };

  // Replace the displayed week's static prompt with a daily, content-aware one
  // (reads the chapter draft + evidence matrix, picks the thinnest/most-needed
  // beat, has the LLM phrase it, falls back to the static prompt). Keeps the
  // hand-written `prompt` from book-plan.json as the fallback.
  async function finalize(result) {
    const wk = result.week;
    if (wk && wk.draft_file && wk.draft_file.startsWith('03_Chapters/')) {
      try {
        const ch = (result.draft_words && result.draft_words.chapters || []).find((c) => c.file === wk.draft_file);
        const info = await getDailyPrompt({
          vault: VAULT,
          chapterPath: wk.draft_file,
          chapterTitle: (ch && ch.title) || wk.draft || '',
          matrixPath: wk.evidence_matrix || null,
          beatsFallback: wk.beats || null,
          weekPrompt: wk.prompt || '',
          history: (result.draft_words && result.draft_words.history) || [],
          iso,
        });
        if (info && info.text) {
          result.week = { ...wk, prompt: info.text };
          result.daily_prompt = info;
        }
      } catch { /* keep the static prompt */ }
    }
    return result;
  }

  const base = {
    target: plan.target || '',
    role: plan.role || '',
    cadence: plan.cadence || '',
    sample_chapters: plan.sample_chapters || [],
    guardrails: plan.guardrails || [],
    today: { iso, weekday: WEEKDAYS[dow], label: '' },
    weeks_total: weeks.length,
    weeks,
    week: null,
    next_week: null,
    blocks: [],
  };

  if (weeks.length === 0) {
    return finalize({ ...base, phase: 'preflight', draft_words: getDraftWords(null, 'preflight', dwOpts) });
  }

  const first = weeks[0];
  const last = weeks[weeks.length - 1];

  // Before the plan starts → preflight. Preview Week 1, including the draft
  // blocks, so the write prompt + reading checklist are visible before Monday.
  if (iso < first.start) {
    return finalize({
      ...base,
      phase: 'preflight',
      week: first,
      next_week: weeks[1] || null,
      blocks: (plan.daily_blocks && plan.daily_blocks.draft) || [],
      draft_words: getDraftWords(first, 'preflight', dwOpts),
      today: { iso, weekday: WEEKDAYS[dow], label: `Plan begins ${first.start}` },
    });
  }

  // Past the last week's end → wrapup.
  if (iso > last.end) {
    return finalize({
      ...base,
      phase: 'wrapup',
      week: last,
      draft_words: getDraftWords(last, 'wrapup', dwOpts),
      today: { iso, weekday: WEEKDAYS[dow], label: 'Sample package window complete' },
    });
  }

  // Otherwise we're inside the run. The active week is the last one that has
  // started; weekends between Friday and the next Monday stay attached to the
  // week that just ran.
  let active = first;
  let activeIdx = 0;
  for (let i = 0; i < weeks.length; i++) {
    if (iso >= weeks[i].start) {
      active = weeks[i];
      activeIdx = i;
    }
  }
  const next = weeks[activeIdx + 1] || null;

  let phase;
  let blocks = [];
  if (dow === 0 || dow === 6) {
    phase = 'weekend';
  } else if (dow === 5) {
    phase = 'review';
    blocks = (plan.daily_blocks && plan.daily_blocks.review) || [];
  } else {
    phase = 'draft';
    blocks = (plan.daily_blocks && plan.daily_blocks.draft) || [];
  }

  const label =
    phase === 'review'
      ? `Week ${active.n} of ${weeks.length} · Review day`
      : phase === 'weekend'
      ? `Week ${active.n} of ${weeks.length} · Rest`
      : `Week ${active.n} of ${weeks.length} · Drafting`;

  return finalize({
    ...base,
    phase,
    blocks,
    week: active,
    next_week: next,
    draft_words: getDraftWords(active, phase, dwOpts),
    today: { iso, weekday: WEEKDAYS[dow], label },
  });
}

// ── Run directly for a quick check ────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  getBookPlan().then((p) => console.log(JSON.stringify(p, null, 2)));
}

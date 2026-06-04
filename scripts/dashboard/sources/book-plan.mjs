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

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLAN_PATH = join(__dirname, '..', 'book-plan.json');
const VAULT = process.env.VAULT_PATH || join(homedir(), 'vaults/PostLiterate');
const CHAPTERS_DIR = join(VAULT, '03_Chapters');
const DRAFT_WORDS_PATH = join(__dirname, '..', 'snapshots', 'draft-words.json');

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

// Word counts for the prose drafts in 03_Chapters (*.draft.md). Tracks a
// per-week baseline (snapshots/draft-words.json) so `this_week` = words added
// since the active week began. Baseline is recorded on the first refresh of a
// non-preflight week.
function getDraftWords(activeWeek, phase) {
  let by_file;
  try {
    if (!existsSync(CHAPTERS_DIR)) return null;
    by_file = readdirSync(CHAPTERS_DIR)
      .filter((f) => f.endsWith('.draft.md'))
      .map((f) => {
        const text = readFileSync(join(CHAPTERS_DIR, f), 'utf8');
        return { file: f, words: countProseWords(text), target: frontmatterNum(text, 'word_target') };
      })
      .sort((a, b) => a.file.localeCompare(b.file));
  } catch {
    return null;
  }
  const total = by_file.reduce((s, x) => s + x.words, 0);

  let current = null;
  let current_target = null;
  if (activeWeek && activeWeek.draft_file) {
    const base = activeWeek.draft_file.split('/').pop();
    const hit = by_file.find((x) => x.file === base);
    current = hit ? hit.words : 0;
    current_target = (hit && hit.target) || 2000;
  }

  let this_week = 0;
  try {
    let state = {};
    if (existsSync(DRAFT_WORDS_PATH)) state = JSON.parse(readFileSync(DRAFT_WORDS_PATH, 'utf8'));
    state.week_baselines = state.week_baselines || {};
    if (activeWeek && phase !== 'preflight') {
      if (state.week_baselines[activeWeek.start] === undefined) {
        state.week_baselines[activeWeek.start] = total;
        writeFileSync(DRAFT_WORDS_PATH, JSON.stringify(state, null, 2), 'utf8');
      }
      this_week = total - state.week_baselines[activeWeek.start];
    }
  } catch {
    this_week = 0;
  }

  return { total, current, current_target, this_week, by_file };
}

export async function getBookPlan(now = new Date()) {
  if (!existsSync(PLAN_PATH)) {
    return { error: 'book-plan.json not found', weeks: [], blocks: [] };
  }

  const plan = JSON.parse(readFileSync(PLAN_PATH, 'utf8'));
  const weeks = Array.isArray(plan.weeks) ? plan.weeks : [];
  const iso = todayIso(now);
  const dow = weekdayIndex(iso);

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
    return { ...base, phase: 'preflight', draft_words: getDraftWords(null, 'preflight') };
  }

  const first = weeks[0];
  const last = weeks[weeks.length - 1];

  // Before the plan starts → preflight. Preview Week 1, including the draft
  // blocks, so the write prompt + reading checklist are visible before Monday.
  if (iso < first.start) {
    return {
      ...base,
      phase: 'preflight',
      week: first,
      next_week: weeks[1] || null,
      blocks: (plan.daily_blocks && plan.daily_blocks.draft) || [],
      draft_words: getDraftWords(first, 'preflight'),
      today: { iso, weekday: WEEKDAYS[dow], label: `Plan begins ${first.start}` },
    };
  }

  // Past the last week's end → wrapup.
  if (iso > last.end) {
    return {
      ...base,
      phase: 'wrapup',
      week: last,
      draft_words: getDraftWords(last, 'wrapup'),
      today: { iso, weekday: WEEKDAYS[dow], label: 'Sample package window complete' },
    };
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

  return {
    ...base,
    phase,
    blocks,
    week: active,
    next_week: next,
    draft_words: getDraftWords(active, phase),
    today: { iso, weekday: WEEKDAYS[dow], label },
  };
}

// ── Run directly for a quick check ────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  getBookPlan().then((p) => console.log(JSON.stringify(p, null, 2)));
}

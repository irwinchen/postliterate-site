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

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLAN_PATH = join(__dirname, '..', 'book-plan.json');

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
    return { ...base, phase: 'preflight' };
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
      today: { iso, weekday: WEEKDAYS[dow], label: `Plan begins ${first.start}` },
    };
  }

  // Past the last week's end → wrapup.
  if (iso > last.end) {
    return {
      ...base,
      phase: 'wrapup',
      week: last,
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
    today: { iso, weekday: WEEKDAYS[dow], label },
  };
}

// ── Run directly for a quick check ────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  getBookPlan().then((p) => console.log(JSON.stringify(p, null, 2)));
}

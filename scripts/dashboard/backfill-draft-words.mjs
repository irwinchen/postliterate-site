/**
 * backfill-draft-words.mjs — one-shot repair for the daily "Writing activity"
 * chart history.
 *
 * Why this exists
 * ---------------
 * Before the fix in sources/book-plan.mjs, getDraftWords() re-sampled each new
 * day's `start` baseline from the live prose total. Anything written between the
 * last refresh of one day and the first refresh of the next fell into the gap
 * and was counted toward neither day, so those days render as 0 on the chart.
 *
 * The code fix is forward-only. This script repairs the *existing* history by
 * re-chaining every day's `start` to the previous day's `end` (the last known
 * running total). Observed `end` totals are never touched — only the `start`
 * baselines that created the gaps. After this runs, the per-day series is
 * continuous and every recoverable word lands in the day it was first observed.
 *
 * draft-words.json is a gitignored, per-machine cache, so it does NOT travel via
 * git. Run this on the machine whose chart you want to repair (the Mac Mini),
 * after that machine has pulled the book-plan.mjs fix. The repair is durable:
 * future refreshes only update today's `end` and chain new days correctly, so
 * they won't undo it.
 *
 * Usage (from the repo root):
 *   node scripts/dashboard/backfill-draft-words.mjs            # dry run — show the diff
 *   node scripts/dashboard/backfill-draft-words.mjs --apply    # write (after a .bak backup)
 *
 * Honors DRAFT_WORDS_PATH (same env var book-plan.mjs reads) if set.
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DRAFT_WORDS_PATH =
  process.env.DRAFT_WORDS_PATH || join(__dirname, 'snapshots', 'draft-words.json');

const APPLY = process.argv.includes('--apply');

function words(entry) {
  return Math.max(0, (entry.end || 0) - (entry.start || 0));
}

function main() {
  if (!existsSync(DRAFT_WORDS_PATH)) {
    console.error(`No draft-words.json at ${DRAFT_WORDS_PATH} — nothing to backfill.`);
    process.exit(1);
  }

  const state = JSON.parse(readFileSync(DRAFT_WORDS_PATH, 'utf8'));
  const history = state.history || {};
  const days = Object.keys(history).sort();

  if (days.length === 0) {
    console.error('History is empty — nothing to backfill.');
    process.exit(1);
  }

  console.log(`draft-words.json: ${DRAFT_WORDS_PATH}`);
  console.log(`${days.length} day(s) in history\n`);
  console.log('date        old start→end  (words)   new start→end  (words)   note');
  console.log('─'.repeat(78));

  let prevEnd = null; // running total carried across days
  let recovered = 0;
  let changed = 0;
  const next = {}; // proposed history

  for (const d of days) {
    const cur = history[d];
    const oldEntry = { start: cur.start || 0, end: cur.end || 0 };
    // The first day keeps its start (it is the anchor baseline — there is no
    // prior day to chain to). Every later day chains to the prior day's end.
    const newStart = prevEnd === null ? oldEntry.start : prevEnd;
    const newEntry = { start: newStart, end: oldEntry.end };
    next[d] = newEntry;

    const oldW = words(oldEntry);
    const newW = words(newEntry);
    const delta = newW - oldW;
    if (newEntry.start !== oldEntry.start) changed++;
    recovered += delta;

    // Flag a total that went DOWN vs the prior day (deletion or a bad scan):
    // chaining would attribute a big jump to the following day, so surface it.
    let note = '';
    if (prevEnd !== null && oldEntry.end < prevEnd) {
      note = `⚠ total dropped (${prevEnd}→${oldEntry.end})`;
    } else if (delta > 0) {
      note = `+${delta} recovered`;
    } else if (newEntry.start !== oldEntry.start) {
      note = 're-chained';
    }

    console.log(
      `${d}  ${String(oldEntry.start).padStart(6)}→${String(oldEntry.end).padEnd(6)} ` +
        `${String('(' + oldW + ')').padEnd(8)}  ` +
        `${String(newEntry.start).padStart(6)}→${String(newEntry.end).padEnd(6)} ` +
        `${String('(' + newW + ')').padEnd(8)} ${note}`
    );

    prevEnd = oldEntry.end;
  }

  console.log('─'.repeat(78));
  console.log(`\n${changed} day(s) re-chained, ${recovered} word(s) recovered into the chart.`);

  if (recovered < 0) {
    console.log(
      '\n⚠ Net recovered is negative — a non-monotonic `end` is present (see the ⚠ rows).\n' +
        '  Review those before applying; the observed totals are left untouched either way.'
    );
  }

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to write the changes.');
    return;
  }

  const backup = DRAFT_WORDS_PATH + '.bak';
  copyFileSync(DRAFT_WORDS_PATH, backup);
  const out = { ...state, history: next };
  writeFileSync(DRAFT_WORDS_PATH, JSON.stringify(out, null, 2), 'utf8');
  console.log(`\nApplied. Backup written to ${backup}`);
}

main();

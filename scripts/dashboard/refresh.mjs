#!/usr/bin/env node

/**
 * Dashboard refresh — entry point.
 *
 * Called by:
 *   - POST /api/refresh (on-demand from the dashboard UI)
 *   - Server startup in admin.mjs
 *   - Directly: node scripts/dashboard/refresh.mjs
 *
 * In Phase 1 this writes a skeleton snapshot with null section values.
 * Subsequent phases fill in each section:
 *   Phase 2 → cards
 *   Phase 3 → vault_watch
 *   Phase 4 → writing
 *   Phase 5 → reminders
 *   Phase 6 → activity
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCards } from './sources/cards.mjs';
import { getVaultWatch } from './sources/vault-watch.mjs';
import { getWritingProgress } from './sources/writing-progress.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS_DIR = join(__dirname, 'snapshots');

/**
 * Run all data sources and write snapshots/latest.json.
 * Returns the snapshot object.
 */
export async function refresh() {
  mkdirSync(SNAPSHOTS_DIR, { recursive: true });

  const snapshot = {
    refreshed_at: new Date().toISOString(),
    cards: null,       // Phase 2 — parse 06_Meta/Book/Cards/INDEX.md
    vault_watch: null, // Phase 3 — outstanding sources, reading queue
    writing: null,     // Phase 4 — word counts + sparkline snapshots
    reminders: null,   // Phase 5 — TASKS.md
    activity: null,    // Phase 6 — Cowork sessions, chat exports, git
  };

  // Phase 2 — Cards
  try {
    snapshot.cards = await getCards();
    console.log(`  Cards: ${snapshot.cards.total} loaded.`);
  } catch (err) {
    console.warn(`  Warning: cards failed — ${err.message}`);
  }

  // Phase 3 — Vault Watch
  try {
    snapshot.vault_watch = await getVaultWatch();
    const vw = snapshot.vault_watch;
    console.log(
      `  Vault Watch: ${vw.outstanding_sources.count} outstanding source(s), ` +
        `${vw.reading_queue.to_read} to-read in queue, ` +
        `${vw.recent_daily_notes.length} recent daily notes.`
    );
  } catch (err) {
    console.warn(`  Warning: vault-watch failed — ${err.message}`);
  }

  // Phase 4 — Writing progress
  try {
    snapshot.writing = await getWritingProgress();
    const w = snapshot.writing.counts;
    console.log(
      `  Writing: ${w.cards.words} cards · ${w.blog.words} blog · ` +
        `${w.daily.words} daily · ${w.ideas.words} ideas (${snapshot.writing.sparklines.dates.length} day(s) of history).`
    );
  } catch (err) {
    console.warn(`  Warning: writing-progress failed — ${err.message}`);
  }

  const outPath = join(SNAPSHOTS_DIR, 'latest.json');
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2), 'utf8');

  return snapshot;
}

// ── Run directly ─────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  refresh()
    .then((s) => console.log('Snapshot written:', s.refreshed_at))
    .catch((err) => {
      console.error('Refresh failed:', err.message);
      process.exit(1);
    });
}

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
    // Each key is populated by its phase; null = not yet implemented.
    cards: null,       // Phase 2 — parse 06_Meta/Book/Cards/INDEX.md
    vault_watch: null, // Phase 3 — outstanding sources, reading queue
    writing: null,     // Phase 4 — word counts + sparkline snapshots
    reminders: null,   // Phase 5 — TASKS.md
    activity: null,    // Phase 6 — Cowork sessions, chat exports, git
  };

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

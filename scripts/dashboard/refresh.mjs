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
import { getBookPlan } from './sources/book-plan.mjs';
import { getCards } from './sources/cards.mjs';
import { getVaultWatch } from './sources/vault-watch.mjs';
import { getFigures } from './sources/figures.mjs';
import { getTodos } from './sources/todos.mjs';
import { getGitActivity } from './sources/git-activity.mjs';
import { getCoworkSessions } from './sources/cowork-sessions.mjs';
import { getClaudeExports } from './sources/claude-exports.mjs';
import { getVaultSessions } from './sources/vault-sessions.mjs';
import { getSessionDebriefs } from './sources/session-debriefs.mjs';
import { getWorkingConversations } from './sources/working-conversations.mjs';

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
    book_plan: null,   // Today panel — daily/weekly writing plan (book-plan.json)
    cards: null,       // Phase 2 — parse 06_Meta/Book/Cards/INDEX.md
    vault_watch: null, // Phase 3 — outstanding sources, reading queue
    figures: null,     // Phase 7 — project image galleries
    reminders: null,   // Phase 5 — TASKS.md
    activity: null,    // Phase 6 — git + vault sessions (cowork/chat moved
                       //   into working_conversations)
    working_conversations: null, // Phase 6 Slice 3 — unified feed
  };

  // Today panel — writing plan
  try {
    snapshot.book_plan = await getBookPlan();
    const bp = snapshot.book_plan;
    console.log(
      `  Book plan: phase=${bp.phase}` +
        (bp.week ? `, week ${bp.week.n}/${bp.weeks_total} (${bp.week.draft})` : '') +
        `, ${bp.blocks.length} block(s) today.`
    );
  } catch (err) {
    console.warn(`  Warning: book-plan failed — ${err.message}`);
  }

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

  // Phase 7 — Figures (project image galleries)
  try {
    snapshot.figures = await getFigures();
    const f = snapshot.figures;
    console.log(
      `  Figures: ${f.total_projects} project(s), ${f.total_images} image(s), ${f.missing_images} missing.`
    );
  } catch (err) {
    console.warn(`  Warning: figures failed — ${err.message}`);
  }

  // Phase 5 — Reminders (TASKS.md)
  try {
    snapshot.reminders = await getTodos();
    const r = snapshot.reminders;
    console.log(
      `  Reminders: ${r.open} open · ${r.done} done · ` +
        `${r.overdue} overdue · ${r.due_today} due today.`
    );
  } catch (err) {
    console.warn(`  Warning: todos failed — ${err.message}`);
  }

  // Phase 6 — Activity streams (each summarized via Ollama when available)
  snapshot.activity = {};

  try {
    snapshot.activity.git = await getGitActivity();
    const a = snapshot.activity.git;
    const totalCommits = a.days.reduce((sum, d) => sum + d.commits.length, 0);
    const summarized = a.days.filter((d) => d.summary).length;
    console.log(
      `  Activity (git): ${totalCommits} commit(s) over ${a.days.length} day(s) — ` +
        `Ollama ${a.ollama_available ? `up (${a.model})` : 'unavailable, raw rendering'} · ` +
        `${summarized}/${a.days.length} summarized.`
    );
  } catch (err) {
    console.warn(`  Warning: git-activity failed — ${err.message}`);
  }

  // cowork-sessions and claude-exports both write normalized JSON files
  // into snapshots/conversations/ as a side effect. Their return values
  // are no longer assigned to the snapshot — the working_conversations
  // aggregator below is the single consumer.
  try {
    const c = await getCoworkSessions();
    const summarized = c.sessions.filter((s) => s.summary).length;
    console.log(
      `  Activity (cowork): ${c.sessions.length} session(s) — ${summarized}/${c.sessions.length} summarized.`
    );
  } catch (err) {
    console.warn(`  Warning: cowork-sessions failed — ${err.message}`);
  }

  try {
    const e = await getClaudeExports();
    console.log(`  Activity (claude.ai exports): ${e.exports.length} file(s).`);
  } catch (err) {
    console.warn(`  Warning: claude-exports failed — ${err.message}`);
  }

  try {
    snapshot.activity.vault_sessions = await getVaultSessions();
    const v = snapshot.activity.vault_sessions;
    console.log(`  Activity (vault sessions): ${v.sessions.length} digest(s).`);
  } catch (err) {
    console.warn(`  Warning: vault-sessions failed — ${err.message}`);
  }

  // Phase 6 (Slice 3) — session-debriefs source. Side-effect only: writes
  // normalized JSON into snapshots/conversations/ for the aggregator below.
  try {
    await getSessionDebriefs();
  } catch (err) {
    console.warn(`  Warning: session-debriefs failed — ${err.message}`);
  }

  // Working conversations — unified feed over cowork + chat + debrief.
  // The three sources above wrote normalized files; this aggregator just
  // reads, sorts, and slices.
  try {
    snapshot.working_conversations = await getWorkingConversations();
    const w = snapshot.working_conversations;
    const byType = w.items.reduce((acc, it) => {
      acc[it.type] = (acc[it.type] || 0) + 1;
      return acc;
    }, {});
    const filteredNote = w.filtered_out ? ` · ${w.filtered_out} hidden as not book-relevant` : '';
    console.log(
      `  Working conversations: ${w.returned} of ${w.total} ` +
        `(cowork: ${byType.cowork || 0}, chat: ${byType.chat || 0}, debrief: ${byType.debrief || 0})${filteredNote}.`
    );
  } catch (err) {
    console.warn(`  Warning: working-conversations failed — ${err.message}`);
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

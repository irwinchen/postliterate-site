/**
 * cowork-sessions.mjs — Phase 6 (Slice 2)
 *
 * Reads ~/.claude/history.jsonl (the global Cowork prompt log) and
 * surfaces sessions whose project path matches the vault, the site
 * repo, or any worktree under either. Groups prompts by sessionId,
 * builds a third-person session summary via Ollama (when available),
 * and falls back to the first prompt as a label otherwise.
 *
 * Privacy note: only history entries whose `project` field starts
 * with a configured prefix are read at all. Prompts from unrelated
 * projects are never loaded into the dashboard process.
 *
 * Output shape:
 * {
 *   ollama_available: boolean,
 *   model: string | null,
 *   sessions: [
 *     {
 *       session_id, project_path, project_label,
 *       date,                 // YYYY-MM-DD of first prompt in the session
 *       first_at, last_at,    // ISO timestamps
 *       prompt_count,
 *       first_prompt,         // truncated, for fallback labelling
 *       summary,              // null when Ollama unavailable
 *     }
 *   ]
 * }
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { isAvailable, getOllamaConfig } from '../lib/ollama.mjs';
import { summarize } from '../lib/summary-cache.mjs';
import { saveNormalized, shouldReingest, getExistingSummary, pruneStale } from '../lib/conversation-store.mjs';

const HISTORY_PATH = join(homedir(), '.claude/history.jsonl');
const DAYS_BACK = 7;
const MAX_PROMPTS_IN_PROMPT = 25; // cap for the LLM prompt
const MAX_SESSIONS = 10; // most recent

// Skip cowork sessions that are obviously trivial: a one- or two-prompt
// session where every prompt is a slash command (/exit, /doctor, /plugin).
// The user reads the feed to remember substantive work, not commands.
const MIN_PROMPTS_IF_ALL_SLASH = 3;
function isSlashCommand(text) {
  return typeof text === 'string' && /^\s*\/[a-z]/i.test(text.trim());
}
function isTrivialSession(session) {
  if (session.prompts.length >= MIN_PROMPTS_IF_ALL_SLASH) return false;
  return session.prompts.every((p) => isSlashCommand(p.text));
}

// Project prefixes the dashboard cares about. Worktrees match by prefix.
// VAULT_PATH overrides the second entry if set. The third entry is the
// Mini's vault location (different parent dir than the MacBook's).
const SITE_REPO = '/Users/irwinchen/Documents/postliterate-site';
const VAULT_DEFAULT = process.env.VAULT_PATH || join(homedir(), 'vaults/PostLiterate');
const RELEVANT_PROJECT_PREFIXES = [
  SITE_REPO,
  VAULT_DEFAULT,
  join(homedir(), 'Documents/Postliterate'), // Mini's local vault path
];

function projectLabel(projectPath) {
  if (projectPath.startsWith(SITE_REPO)) return 'site';
  if (projectPath.startsWith(VAULT_DEFAULT)) return 'vault';
  if (projectPath.startsWith(join(homedir(), 'Documents/Postliterate'))) return 'vault';
  return 'other';
}

function isRelevantProject(projectPath) {
  if (typeof projectPath !== 'string') return false;
  return RELEVANT_PROJECT_PREFIXES.some((p) => projectPath.startsWith(p));
}

// ── Read + filter ────────────────────────────────────────────────
function readRelevantHistory() {
  if (!existsSync(HISTORY_PATH)) return [];
  let text;
  try {
    text = readFileSync(HISTORY_PATH, 'utf8');
  } catch {
    return [];
  }

  const cutoffMs = Date.now() - DAYS_BACK * 24 * 60 * 60 * 1000;
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRelevantProject(entry.project)) continue;
    if (typeof entry.timestamp !== 'number' || entry.timestamp < cutoffMs) continue;
    if (!entry.sessionId) continue;
    out.push(entry);
  }
  return out;
}

// ── Group by session ─────────────────────────────────────────────
function groupBySession(entries) {
  const map = new Map();
  for (const e of entries) {
    if (!map.has(e.sessionId)) {
      map.set(e.sessionId, {
        session_id: e.sessionId,
        project_path: e.project,
        prompts: [],
        first_ts: e.timestamp,
        last_ts: e.timestamp,
      });
    }
    const s = map.get(e.sessionId);
    s.prompts.push({ ts: e.timestamp, text: typeof e.display === 'string' ? e.display : '' });
    if (e.timestamp < s.first_ts) s.first_ts = e.timestamp;
    if (e.timestamp > s.last_ts) s.last_ts = e.timestamp;
  }
  // Sort prompts within each session chronologically.
  for (const s of map.values()) {
    s.prompts.sort((a, b) => a.ts - b.ts);
  }
  // Sort sessions by last_ts desc, take MAX_SESSIONS.
  return [...map.values()].sort((a, b) => b.last_ts - a.last_ts).slice(0, MAX_SESSIONS);
}

// ── Prompt builder ───────────────────────────────────────────────
const SYSTEM_PROMPT =
  "You summarize a single Claude Code (Cowork) session for the writing+coding project 'After the Book'. " +
  "You are given the user's prompts from one session in chronological order. The user is Irwin Chen — DO NOT write in first person as him; use third person.\n\n" +
  "Write 2-3 sentences of plain prose (no bullets, no headers, no bold). " +
  "Sentence 1: what the session was actually about — the problem or question being worked on. " +
  "Sentence 2-3: how the work evolved — what got tried, what was decided, where it landed or what's still open. " +
  "Be specific: name the files, decisions, or topics rather than gesturing at them. " +
  "Don't restate the first prompt verbatim — the dashboard already shows it separately.";

function truncate(s, n) {
  if (typeof s !== 'string') return '';
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  return s.slice(0, n).replace(/\s+\S*$/, '') + '…';
}

function buildSessionPrompt(session) {
  const project = projectLabel(session.project_path);
  const prompts = session.prompts.slice(0, MAX_PROMPTS_IN_PROMPT);
  const date = new Date(session.first_ts).toISOString().slice(0, 10);
  const lines = prompts.map((p, i) => `${i + 1}. ${truncate(p.text, 240)}`).join('\n');
  return `Project: ${project} (${session.project_path})
Date: ${date}
Prompt count: ${session.prompts.length}${session.prompts.length > prompts.length ? ` (showing first ${prompts.length})` : ''}

User prompts in chronological order:
${lines}`;
}

// Hash the system prompt into the source key so that any change to
// SYSTEM_PROMPT invalidates the normalized records, forcing re-summarization
// on the next refresh.
const SYSTEM_PROMPT_HASH = createHash('sha256').update(SYSTEM_PROMPT).digest('hex').slice(0, 8);

function sourceKeyFor(g) {
  return createHash('sha256')
    .update(SYSTEM_PROMPT_HASH)
    .update('␟')
    .update(g.session_id)
    .update('␟')
    .update(String(g.last_ts))
    .update('␟')
    .update(String(g.prompts.length))
    .digest('hex')
    .slice(0, 16);
}

function buildNormalized(g, { sessionSummary, summaryStatus }) {
  const date = new Date(g.first_ts).toISOString().slice(0, 10);
  // Use the first SUBSTANTIVE prompt for the lead-in. Skip slash commands
  // and short conversational fillers ("ok", "yes", "continue") — index on
  // the prompt that actually sets up the work, not on the warm-up.
  const isFiller = (text) => {
    if (typeof text !== 'string') return true;
    const trimmed = text.trim();
    if (trimmed.length < 20) return true;
    if (isSlashCommand(trimmed)) return true;
    return false;
  };
  const firstSubstantive = g.prompts.find((p) => !isFiller(p.text)) || g.prompts[0];
  const first_prompt = truncate(firstSubstantive?.text || '', 200);
  const label = projectLabel(g.project_path);
  const title = first_prompt ? truncate(first_prompt, 80) : `Cowork session ${g.session_id.slice(0, 8)}`;

  return {
    schema_version: 1,
    id: g.session_id,
    type: 'cowork',
    project_label: label,
    project_path: g.project_path,
    title,
    started_at: new Date(g.first_ts).toISOString(),
    last_activity_at: new Date(g.last_ts).toISOString(),
    message_count: g.prompts.length,
    first_prompt,
    summary: sessionSummary,
    summary_status: summaryStatus,
    // Cowork sessions are already pre-filtered by RELEVANT_PROJECT_PREFIXES
    // to the site repo + vault, so they're book-relevant by construction.
    book_relevance: 'yes',
    book_relevance_method: 'project_prefilter',
    book_relevance_reason: `project ${label}`,
    artifacts: [],
    source_ref: {
      kind: 'cowork',
      session_id: g.session_id,
      source_key: sourceKeyFor(g),
      date,
    },
  };
}

// ── Main export ──────────────────────────────────────────────────
export async function getCoworkSessions() {
  const cfg = getOllamaConfig();
  const ollamaUp = await isAvailable();

  const entries = readRelevantHistory();
  const grouped = groupBySession(entries).filter((g) => !isTrivialSession(g));

  pruneStale('cowork', grouped.map((g) => g.session_id));

  const sessions = [];
  for (const g of grouped) {
    const date = new Date(g.first_ts).toISOString().slice(0, 10);
    const first_prompt = truncate(g.prompts[0]?.text || '', 200);
    const sourceKey = sourceKeyFor(g);
    const stale = shouldReingest('cowork', g.session_id, sourceKey);

    let sessionSummary = stale ? null : getExistingSummary('cowork', g.session_id);
    let summaryStatus;

    if (g.prompts.length === 0) {
      summaryStatus = 'skipped';
    } else if (sessionSummary) {
      summaryStatus = 'ready';
    } else if (ollamaUp) {
      sessionSummary = await summarize({
        system: SYSTEM_PROMPT,
        prompt: buildSessionPrompt(g),
        label: `cowork-${date}-${g.session_id.slice(0, 8)}`,
      });
      summaryStatus = sessionSummary ? 'ready' : 'pending';
    } else {
      summaryStatus = 'pending';
    }

    // Side effect: write normalized JSON for the working-conversations
    // aggregator. Cheap when the source_key hasn't changed (still writes,
    // but the file is small and rename is atomic).
    try {
      saveNormalized(buildNormalized(g, { sessionSummary, summaryStatus }));
    } catch (err) {
      console.warn(`  cowork-sessions saveNormalized failed (${g.session_id.slice(0, 8)}): ${err.message}`);
    }

    sessions.push({
      session_id: g.session_id,
      project_path: g.project_path,
      project_label: projectLabel(g.project_path),
      date,
      first_at: new Date(g.first_ts).toISOString(),
      last_at: new Date(g.last_ts).toISOString(),
      prompt_count: g.prompts.length,
      first_prompt,
      summary: sessionSummary,
    });
  }

  return {
    ollama_available: ollamaUp,
    model: cfg.model,
    sessions,
  };
}

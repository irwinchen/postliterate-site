/**
 * conversation-store.mjs — read/write/list normalized "working conversation"
 * JSON files under scripts/dashboard/snapshots/conversations/.
 *
 * Every source (cowork-sessions, claude-exports, session-debriefs) writes
 * through here so all three behave identically: atomic temp-rename writes,
 * filename convention {type}-{YYYY-MM-DD}-{shortid}.json, and a uniform
 * shouldReingest() check keyed on source_ref.source_key.
 *
 * The normalized shape (schema_version 1) is defined in
 * /Users/irwinchen/.claude/plans/i-ve-created-a-new-dazzling-meadow.md.
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  unlinkSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const CONVERSATIONS_DIR = join(__dirname, '../snapshots/conversations');

export const SCHEMA_VERSION = 1;
const KNOWN_TYPES = new Set(['cowork', 'chat', 'debrief']);

function shortId(id) {
  return String(id ?? '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) || 'noid';
}

function dateSlice(conv) {
  const t = conv.last_activity_at || conv.started_at || '';
  if (typeof t !== 'string') return 'undated';
  return t.slice(0, 10) || 'undated';
}

function filename(conv) {
  return `${conv.type}-${dateSlice(conv)}-${shortId(conv.id)}.json`;
}

function safeReadJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export function listNormalized() {
  if (!existsSync(CONVERSATIONS_DIR)) return [];
  let names;
  try {
    names = readdirSync(CONVERSATIONS_DIR).filter(
      (n) => n.endsWith('.json') && !n.startsWith('.')
    );
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    const obj = safeReadJson(join(CONVERSATIONS_DIR, name));
    if (obj && KNOWN_TYPES.has(obj.type)) out.push(obj);
  }
  return out;
}

export function loadByKey(type, id) {
  if (!existsSync(CONVERSATIONS_DIR)) return null;
  const wantedShort = shortId(id);
  let names;
  try {
    names = readdirSync(CONVERSATIONS_DIR).filter(
      (n) => n.startsWith(`${type}-`) && n.includes(wantedShort) && n.endsWith('.json')
    );
  } catch {
    return null;
  }
  for (const name of names) {
    const obj = safeReadJson(join(CONVERSATIONS_DIR, name));
    if (obj && obj.type === type && obj.id === id) return obj;
  }
  return null;
}

export function saveNormalized(conv) {
  if (!conv || typeof conv !== 'object') {
    throw new Error('saveNormalized: invalid conversation object');
  }
  if (!KNOWN_TYPES.has(conv.type)) {
    throw new Error(`saveNormalized: unknown type "${conv.type}"`);
  }
  if (!conv.id) {
    throw new Error('saveNormalized: missing id');
  }

  mkdirSync(CONVERSATIONS_DIR, { recursive: true });
  const stamped = {
    schema_version: SCHEMA_VERSION,
    ...conv,
    ingested_at: new Date().toISOString(),
  };
  const finalPath = join(CONVERSATIONS_DIR, filename(stamped));
  const tmpPath = join(CONVERSATIONS_DIR, `.tmp-${randomUUID()}.json`);
  writeFileSync(tmpPath, JSON.stringify(stamped, null, 2), 'utf8');
  renameSync(tmpPath, finalPath);
  return finalPath;
}

export function shouldReingest(type, id, sourceKey) {
  const existing = loadByKey(type, id);
  if (!existing) return true;
  if (existing.summary_status === 'pending') return true;
  const existingKey = existing?.source_ref?.source_key ?? null;
  return existingKey !== sourceKey;
}

export function getExistingSummary(type, id) {
  const existing = loadByKey(type, id);
  if (!existing) return null;
  if (existing.summary_status !== 'ready') return null;
  return existing.summary;
}

/**
 * Remove normalized files of `type` whose `id` is not in `keptIds`.
 *
 * Used after a source finishes a refresh to drop entries that have been
 * filtered out (e.g. a cowork session that became trivial, or a chat
 * deleted from the user's claude.ai account).
 */
export function pruneStale(type, keptIds) {
  if (!existsSync(CONVERSATIONS_DIR)) return 0;
  if (!KNOWN_TYPES.has(type)) return 0;
  const kept = new Set(keptIds);
  let names;
  try {
    names = readdirSync(CONVERSATIONS_DIR).filter(
      (n) => n.startsWith(`${type}-`) && n.endsWith('.json') && !n.startsWith('.')
    );
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    const full = join(CONVERSATIONS_DIR, name);
    const obj = safeReadJson(full);
    if (!obj || obj.type !== type) continue;
    if (kept.has(obj.id)) continue;
    try {
      unlinkSync(full);
      removed += 1;
    } catch {}
  }
  return removed;
}

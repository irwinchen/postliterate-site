/**
 * vault-sessions.mjs — Phase 6 (Slice 2)
 *
 * Surfaces per-session digest markdown files written into
 * vault/06_Meta/Sessions/ by Phase 7 (the MacBook hourly Cowork digest
 * job). Until Phase 7 ships, this dir doesn't exist yet — this source
 * gracefully returns an empty list.
 *
 * Each digest is a markdown file. We surface its frontmatter (if any)
 * and a short body preview directly — no LLM call needed, since the
 * digest itself is the summary.
 *
 * Output shape:
 * {
 *   sessions: [
 *     { file, name, mtime, frontmatter: { title?, date?, ... },
 *       preview, size_bytes }
 *   ]
 * }
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const VAULT = process.env.VAULT_PATH || join(homedir(), 'vaults/PostLiterate');
const SESSIONS_DIR = join(VAULT, '06_Meta/Sessions');

const MAX_SESSIONS = 12;
const PREVIEW_CHARS = 400;

// Minimal YAML key:value extractor — same shape used elsewhere in
// the dashboard for source-note frontmatter. Handles bare scalars
// and quoted strings; doesn't try to handle arrays here (digests
// don't use them).
function parseSimpleFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { frontmatter: {}, body: text };
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const val = kv[2].trim().replace(/^["']|["']$/g, '');
    fm[kv[1]] = val;
  }
  return { frontmatter: fm, body: text.slice(m[0].length) };
}

function previewFromBody(body) {
  const cleaned = body
    .split(/\r?\n/)
    .map((line) => line.replace(/^#{1,6}\s+/, '').replace(/^\s*[-*+]\s+/, ''))
    .filter((line) => line.trim().length > 0)
    .join(' ')
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  if (cleaned.length <= PREVIEW_CHARS) return cleaned;
  return cleaned.slice(0, PREVIEW_CHARS).replace(/\s+\S*$/, '') + '…';
}

export async function getVaultSessions() {
  if (!existsSync(SESSIONS_DIR)) return { sessions: [] };

  let names;
  try {
    names = readdirSync(SESSIONS_DIR).filter((n) => /\.md$/i.test(n));
  } catch {
    return { sessions: [] };
  }

  const items = [];
  for (const name of names) {
    const full = join(SESSIONS_DIR, name);
    let st;
    try {
      st = statSync(full);
      if (!st.isFile()) continue;
    } catch {
      continue;
    }
    let text;
    try {
      text = readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    const { frontmatter, body } = parseSimpleFrontmatter(text);
    items.push({
      file: name,
      name: name.replace(/\.md$/, ''),
      mtime: new Date(st.mtimeMs).toISOString(),
      size_bytes: st.size,
      frontmatter,
      preview: previewFromBody(body),
    });
  }

  items.sort((a, b) => (b.mtime || '').localeCompare(a.mtime || ''));
  return { sessions: items.slice(0, MAX_SESSIONS) };
}

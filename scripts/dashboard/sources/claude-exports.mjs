/**
 * claude-exports.mjs — Phase 6 (Slice 2)
 *
 * Reads Claude.ai bulk-export zips dropped into
 * ~/Documents/postliterate-chat-exports/. Anthropic's web UI no longer
 * exposes per-conversation JSON export; only the account-level zip
 * (Settings → Privacy → Export data, emailed 24-48h after request)
 * contains full transcripts. So we look for `*.zip` files in the drop
 * dir, extract `conversations.json` (a JSON array of every conversation
 * including assistant replies), filter to PostLiterate-related titles,
 * and summarize each via Ollama.
 *
 * Anthropic's export does NOT preserve project assignment in
 * `conversations.json`, so we filter by case-insensitive substring
 * match against the conversation `name` (title) using the keyword set
 * below. Tweak POSTLITERATE_TITLE_KEYWORDS to widen or narrow.
 *
 * Pipeline per refresh:
 *   1. Find the newest .zip in the drop dir.
 *   2. If we've already processed that exact zip (matching path + size),
 *      skip extraction; reuse the slim cache.
 *   3. Otherwise extract conversations.json, filter by title keywords,
 *      write the matched subset to claude-archive/postliterate.json.
 *      Delete the big extracted file afterwards.
 *   4. Read the slim cache. For each conversation, ask the LLM for a
 *      summary (cached by content hash via lib/summary-cache).
 *   5. Cap at MAX_RETURNED most-recent so first run isn't unbounded.
 *
 * Output shape:
 * {
 *   ollama_available, model, source: <zip filename>|null,
 *   matched_total, returned, exports: [{...}]
 * }
 */

import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { isAvailable, getOllamaConfig } from '../lib/ollama.mjs';
import { summarize } from '../lib/summary-cache.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DROP_DIR = join(homedir(), 'Documents/postliterate-chat-exports');
const ARCHIVE_DIR = join(__dirname, '../snapshots/claude-archive');
const SLIM_PATH = join(ARCHIVE_DIR, 'postliterate.json');
const STAMP_PATH = join(ARCHIVE_DIR, 'last-extracted.json');

// Title-substring filter (case-insensitive) for the PostLiterate Book
// Project. Anthropic doesn't tag conversations with their project in
// the export, so we approximate from the title.
const POSTLITERATE_TITLE_KEYWORDS = [
  'postliterate', 'post-literate', 'post literate',
  'after the book',
  'orality', 'orali', // covers "oralities", "Orality and Literacy"
  'literacy',
  'obsidian',
  'reading',
  'thoth', 'luria', 'mcluhan', 'ong', 'vygotsky',
];

const MAX_RETURNED = Number(process.env.CLAUDE_EXPORT_MAX) || 25;
const MAX_MESSAGES_FOR_PROMPT = 30;

const SYSTEM_PROMPT =
  "You summarize a single Claude.ai conversation between Irwin Chen and the assistant. " +
  "It's part of a book project called 'After the Book' on literacy, orality, and AI. " +
  "You see both Irwin's questions and Claude's responses. Describe in third person what was discussed and what was concluded. " +
  "DO NOT write in first person as Irwin.\n\n" +
  "Output exactly 2-4 markdown bullets, ONE PER LINE, each starting with '- '. " +
  "Each bullet is one short sentence. No preamble, no headers, no quoting verbatim.";

// ── Zip discovery ───────────────────────────────────────────────
function findLatestZip() {
  if (!existsSync(DROP_DIR)) return null;
  let names;
  try {
    names = readdirSync(DROP_DIR).filter((n) => /\.zip$/i.test(n));
  } catch {
    return null;
  }
  if (names.length === 0) return null;
  let latest = null;
  for (const n of names) {
    const path = join(DROP_DIR, n);
    let st;
    try { st = statSync(path); } catch { continue; }
    if (!st.isFile()) continue;
    if (!latest || st.mtimeMs > latest.mtime) {
      latest = { path, name: n, mtime: st.mtimeMs, size: st.size };
    }
  }
  return latest;
}

// ── Filter ──────────────────────────────────────────────────────
function matchesPostLiterate(title) {
  if (typeof title !== 'string') return false;
  const t = title.toLowerCase();
  return POSTLITERATE_TITLE_KEYWORDS.some((k) => t.includes(k));
}

// ── Extract + filter on first encounter of a new zip ────────────
function ensureSlimCache(zip) {
  // Check if we've already processed this exact zip.
  if (existsSync(SLIM_PATH) && existsSync(STAMP_PATH)) {
    try {
      const stamp = JSON.parse(readFileSync(STAMP_PATH, 'utf8'));
      if (stamp.zip === zip.path && stamp.size === zip.size) {
        return; // up to date
      }
    } catch { /* fall through to re-extract */ }
  }

  mkdirSync(ARCHIVE_DIR, { recursive: true });

  // Extract just conversations.json. -j strips paths (so it lands directly
  // in ARCHIVE_DIR). -o overwrites without prompting.
  const extractedPath = join(ARCHIVE_DIR, 'conversations.json');
  execFileSync('unzip', ['-o', '-j', zip.path, 'conversations.json', '-d', ARCHIVE_DIR], {
    stdio: 'pipe',
  });

  // Parse + filter.
  const raw = readFileSync(extractedPath, 'utf8');
  const all = JSON.parse(raw);
  if (!Array.isArray(all)) {
    throw new Error('conversations.json is not a JSON array');
  }
  const matched = all.filter((c) => matchesPostLiterate(c?.name));

  // Slim each matched conversation to fields we actually need.
  const slim = matched.map((c) => ({
    uuid: c.uuid,
    name: c.name || '(untitled)',
    summary: c.summary || null,
    created_at: c.created_at || null,
    updated_at: c.updated_at || null,
    chat_messages: (c.chat_messages || []).map((m) => ({
      sender: m.sender || m.role || null,
      text: m.text || m.content || '',
      created_at: m.created_at || null,
    })),
  }));

  writeFileSync(SLIM_PATH, JSON.stringify(slim, null, 2), 'utf8');
  writeFileSync(
    STAMP_PATH,
    JSON.stringify(
      {
        zip: zip.path,
        zip_name: zip.name,
        size: zip.size,
        extracted_at: new Date().toISOString(),
        matched_count: slim.length,
        total_in_export: all.length,
      },
      null,
      2
    ),
    'utf8'
  );

  // Don't keep the 134MB extracted file around.
  try { unlinkSync(extractedPath); } catch { /* fine */ }
}

// ── Prompt builder ──────────────────────────────────────────────
function buildPrompt(conv) {
  const msgs = conv.chat_messages || [];
  const lines = msgs.slice(0, MAX_MESSAGES_FOR_PROMPT).map((m) => {
    const role = m.sender || 'unknown';
    const text = String(m.text || '').replace(/\s+/g, ' ').trim();
    const truncated = text.length > 600 ? text.slice(0, 600) + '…' : text;
    return `[${role}] ${truncated}`;
  }).join('\n\n');
  const more = msgs.length > MAX_MESSAGES_FOR_PROMPT
    ? ` (showing first ${MAX_MESSAGES_FOR_PROMPT} of ${msgs.length})`
    : '';
  return `Title: ${conv.name}
Created: ${conv.created_at || ''}
Messages: ${msgs.length}${more}

${lines}`;
}

// ── Main export ─────────────────────────────────────────────────
export async function getClaudeExports() {
  const cfg = getOllamaConfig();
  const ollamaUp = await isAvailable();

  const zip = findLatestZip();
  if (!zip) {
    return {
      ollama_available: ollamaUp,
      model: cfg.model,
      source: null,
      matched_total: 0,
      returned: 0,
      exports: [],
    };
  }

  try {
    ensureSlimCache(zip);
  } catch (err) {
    console.warn(`  claude-exports extract failed: ${err.message}`);
    return {
      ollama_available: ollamaUp,
      model: cfg.model,
      source: zip.name,
      matched_total: 0,
      returned: 0,
      exports: [],
      error: err.message,
    };
  }

  let slim;
  try {
    slim = JSON.parse(readFileSync(SLIM_PATH, 'utf8'));
  } catch {
    slim = [];
  }

  const matchedTotal = slim.length;

  // Sort newest first by updated_at, then created_at.
  slim.sort((a, b) =>
    (b.updated_at || b.created_at || '').localeCompare(a.updated_at || a.created_at || '')
  );

  const candidates = slim.slice(0, MAX_RETURNED);

  const exports = [];
  for (const conv of candidates) {
    const msgs = conv.chat_messages || [];
    const human_count = msgs.filter((m) => m.sender === 'human').length;
    const firstHuman = msgs.find((m) => m.sender === 'human');
    const first_prompt = firstHuman ? String(firstHuman.text || '').slice(0, 200) : '';

    let convSummary = null;
    if (ollamaUp && msgs.length > 0) {
      convSummary = await summarize({
        system: SYSTEM_PROMPT,
        prompt: buildPrompt(conv),
        label: `claude-export-${conv.uuid?.slice(0, 8) || 'noid'}`,
      });
    }

    exports.push({
      uuid: conv.uuid,
      name: conv.name,
      created_at: conv.created_at,
      updated_at: conv.updated_at,
      message_count: msgs.length,
      human_message_count: human_count,
      first_prompt,
      summary: convSummary,
    });
  }

  return {
    ollama_available: ollamaUp,
    model: cfg.model,
    source: zip.name,
    matched_total: matchedTotal,
    returned: exports.length,
    exports,
  };
}

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

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { isAvailable, getOllamaConfig } from '../lib/ollama.mjs';
import { summarize } from '../lib/summary-cache.mjs';
import { saveNormalized, shouldReingest, getExistingSummary, loadByKey, pruneStale } from '../lib/conversation-store.mjs';
import { extractArtifacts, stripArtifactTags } from '../lib/artifact-extractor.mjs';
import { classifyBookRelevance, CLASSIFIER_VERSION } from '../lib/book-relevance.mjs';

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
// Keep the prompt comfortably under gemma4:e4b's 4096-token context.
// 15 msgs × 350 chars ≈ 1300 tokens for the transcript, leaving plenty of
// room for the system prompt and the model's output.
const MAX_MESSAGES_FOR_PROMPT = 15;
const MAX_CHARS_PER_MESSAGE = 350;

// Skip claude.ai chats with very few messages — typically abandoned threads,
// typos, or one-shot lookups that aren't worth surfacing on the dashboard.
// 4 messages = 2 round-trips at minimum; below that the conversation didn't
// really go anywhere.
const MIN_MESSAGES = Number(process.env.CLAUDE_EXPORT_MIN_MESSAGES) || 4;

const SYSTEM_PROMPT =
  "You summarize a single Claude.ai conversation between Irwin Chen and the assistant. " +
  "It's part of a book project called 'After the Book' on literacy, orality, and AI. " +
  "You see both Irwin's questions and Claude's responses. Use third person — DO NOT write as Irwin.\n\n" +
  "Write 2-3 sentences of plain prose (no bullets, no headers, no bold). " +
  "Conversations often drift: they start on one question and end up somewhere else as the work unfolds. " +
  "Sentence 1: name the DOMINANT or FINAL subject of the conversation — what it became, not just what it started as. " +
  "Sentence 2-3: trace the trajectory — what came first, what came up later, what got decided or left open. " +
  "Be specific: name books, authors, files, or concrete decisions rather than gesturing at them. " +
  "Don't restate the opening prompt verbatim — the dashboard already shows it separately.";

// Title generation: a single short line (≤8 words) that names the actual
// dominant subject, not the opening question. Replaces the claude.ai title
// outright in normalized records.
const TITLE_SYSTEM_PROMPT =
  "You generate a short title for one Claude.ai conversation. " +
  "Output ONE line, at most 8 words. " +
  "Name the dominant or final subject of the work — what the conversation became, not the opening question. " +
  "If the conversation drifted from its starting topic, name what it became. " +
  "No quotes, no period at the end, no 'Title:' label, no markdown.";

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
    // Strip <antArtifact> XML — the prompt budget is too tight to spend on
    // file contents, and the summarizer doesn't need them to describe the
    // conversation.
    const raw = stripArtifactTags(String(m.text || ''));
    const text = raw.replace(/\s+/g, ' ').trim();
    const truncated = text.length > MAX_CHARS_PER_MESSAGE
      ? text.slice(0, MAX_CHARS_PER_MESSAGE) + '…'
      : text;
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

// Hash both prompts into the source key so prompt changes (summary OR
// title) invalidate existing normalized records and force re-processing
// on next refresh.
const PROMPT_HASH = createHash('sha256')
  .update(SYSTEM_PROMPT)
  .update('␟')
  .update(TITLE_SYSTEM_PROMPT)
  .digest('hex')
  .slice(0, 8);

function sourceKeyFor(conv) {
  // Include CLASSIFIER_VERSION so a bumped classifier invalidates existing
  // normalized records and forces re-classification (and re-summarization)
  // on the next refresh.
  return `${PROMPT_HASH}|cls${CLASSIFIER_VERSION}|${conv.uuid}|${conv.updated_at || conv.created_at || ''}`;
}

// Normalize and cap an LLM-generated title: strip wrapping quotes/markdown,
// trailing punctuation, surrounding whitespace; cap to a reasonable length.
function cleanLlmTitle(raw) {
  if (typeof raw !== 'string') return null;
  let t = raw.trim();
  // Models sometimes echo "Title: ..." despite the system prompt; strip.
  t = t.replace(/^\s*title\s*[:\-—]\s*/i, '');
  // Strip surrounding quotes (single, double, smart) and markdown emphasis.
  t = t.replace(/^[\s"'`*_“”‘’]+|[\s"'`*_“”‘’]+$/g, '');
  // Drop trailing terminal punctuation; titles read better without.
  t = t.replace(/[.!?…]+$/g, '');
  // First non-empty line only.
  t = t.split(/\r?\n/).find((line) => line.trim()) || '';
  t = t.trim();
  if (!t) return null;
  if (t.length > 90) t = t.slice(0, 90).replace(/\s+\S*$/, '') + '…';
  return t;
}

function buildNormalized(conv, { summary, summaryStatus, artifacts, relevance, llmTitle }) {
  const msgs = conv.chat_messages || [];
  const firstHuman = msgs.find((m) => m.sender === 'human');
  const first_prompt = firstHuman ? String(firstHuman.text || '').slice(0, 200) : null;
  const created = conv.created_at || conv.updated_at || new Date().toISOString();
  const updated = conv.updated_at || conv.created_at || created;

  return {
    schema_version: 1,
    id: conv.uuid,
    type: 'chat',
    project_label: null,
    project_path: null,
    // Prefer the LLM-generated title that reflects the dominant/final
    // subject of the conversation. Fall back to the claude.ai-imported
    // title only when the LLM didn't run or returned nothing usable.
    title: llmTitle || conv.name || '(untitled)',
    started_at: created,
    last_activity_at: updated,
    message_count: msgs.length,
    first_prompt,
    summary,
    summary_status: summaryStatus,
    book_relevance: relevance.verdict,
    book_relevance_method: relevance.method,
    book_relevance_reason: relevance.reason,
    artifacts,
    source_ref: {
      kind: 'chat',
      uuid: conv.uuid,
      source_key: sourceKeyFor(conv),
      slim_cache: 'snapshots/claude-archive/postliterate.json',
    },
  };
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

  // Normalize EVERY non-trivial matched conversation (not just the top
  // MAX_RETURNED). The final dashboard cap happens in the aggregator.
  // shouldReingest skips unchanged conversations so this is cheap after
  // the first run.
  const keptUuids = slim
    .filter((c) => c.uuid && (c.chat_messages || []).length >= MIN_MESSAGES)
    .map((c) => c.uuid);
  pruneStale('chat', keptUuids);

  const exports = [];
  for (const conv of slim) {
    if (!conv.uuid) continue;
    const msgs = conv.chat_messages || [];
    if (msgs.length < MIN_MESSAGES) continue;
    const human_count = msgs.filter((m) => m.sender === 'human').length;
    const firstHuman = msgs.find((m) => m.sender === 'human');
    const first_prompt = firstHuman ? String(firstHuman.text || '').slice(0, 200) : '';
    const sourceKey = sourceKeyFor(conv);
    const stale = shouldReingest('chat', conv.uuid, sourceKey);

    let convSummary = stale ? null : getExistingSummary('chat', conv.uuid);
    let summaryStatus;
    let artifacts = [];

    // Classify relevance before deciding whether to summarize. Reuse a
    // prior verdict when source_key is unchanged AND the prior verdict was
    // decisive (heuristic or a confident LLM call). If the prior was
    // "unknown" because Ollama was unreachable at the time, retry — the
    // LLM may be back now and able to resolve the case.
    let relevance;
    if (!stale) {
      const prior = loadByKey('chat', conv.uuid);
      const priorMethod = prior?.book_relevance_method;
      const priorIsDecisive = prior?.book_relevance && priorMethod !== 'ollama_unavailable';
      if (priorIsDecisive) {
        relevance = {
          verdict: prior.book_relevance,
          method: priorMethod || 'cached',
          reason: prior.book_relevance_reason || '',
        };
      }
    }
    if (!relevance) {
      relevance = await classifyBookRelevance({
        title: conv.name,
        firstPrompt: first_prompt,
      });
    }

    // Reuse a prior LLM-generated title when the conversation hasn't
    // changed; otherwise we'll regenerate alongside the summary.
    let llmTitle = null;
    if (!stale) {
      const prior = loadByKey('chat', conv.uuid);
      if (prior?.title && prior.title !== conv.name) {
        llmTitle = prior.title;
      }
    }

    if (msgs.length === 0) {
      summaryStatus = 'skipped';
    } else if (relevance.verdict === 'no') {
      // Junk by classification — never summarize. Hidden by the aggregator.
      summaryStatus = 'skipped';
      convSummary = null;
    } else if (relevance.verdict === 'unknown') {
      // Ambiguous + Ollama can't decide. Keep visible but don't waste
      // cycles summarizing something that may be junk.
      summaryStatus = 'skipped';
      convSummary = null;
    } else if (convSummary && llmTitle) {
      // Both prior outputs reusable.
      summaryStatus = 'ready';
    } else if (ollamaUp) {
      const promptBody = buildPrompt(conv);
      // Sequential — Ollama serializes per-model requests anyway, so
      // Promise.all() just queues the second call behind the first and
      // doubles the effective timeout window.
      if (!llmTitle) {
        const titleRaw = await summarize({
          system: TITLE_SYSTEM_PROMPT,
          prompt: promptBody,
          label: `claude-title-${conv.uuid.slice(0, 8)}`,
          options: { num_predict: 32, temperature: 0.1 },
        });
        llmTitle = cleanLlmTitle(titleRaw) || null;
      }
      if (!convSummary) {
        convSummary = await summarize({
          system: SYSTEM_PROMPT,
          prompt: promptBody,
          label: `claude-export-${conv.uuid.slice(0, 8)}`,
        });
      }
      summaryStatus = convSummary ? 'ready' : 'pending';
    } else {
      summaryStatus = 'pending';
    }

    // Re-extract artifacts when source changed; otherwise reuse the prior list.
    if (stale && msgs.length > 0) {
      for (let i = 0; i < msgs.length; i++) {
        const text = msgs[i]?.text;
        if (typeof text !== 'string' || !text.includes('<antArtifact')) continue;
        const descriptors = extractArtifacts(text, { uuid: conv.uuid, messageIndex: i });
        for (const d of descriptors) artifacts.push(d);
      }
    } else {
      const prior = loadByKey('chat', conv.uuid);
      artifacts = Array.isArray(prior?.artifacts) ? prior.artifacts : [];
    }

    // Side effect: write normalized JSON for the working-conversations aggregator.
    try {
      saveNormalized(buildNormalized(conv, { summary: convSummary, summaryStatus, artifacts, relevance, llmTitle }));
    } catch (err) {
      console.warn(`  claude-exports saveNormalized failed (${conv.uuid?.slice(0, 8)}): ${err.message}`);
    }

    if (exports.length < MAX_RETURNED) {
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

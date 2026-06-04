/**
 * vault-watch.mjs — Phase 3
 *
 * Surfaces "what needs attention in the vault":
 *   - Outstanding sources: raw artifacts in watched 01_Sources/ subfolders
 *     (and loose files in the root) that no `type: source` Source Note
 *     references via frontmatter wikilink.
 *   - Reading queue: parsed from 01_Sources/READING_QUEUE.md
 *   - Recent daily notes (06_Meta/Daily/)
 *   - Recent inbox items (00_Inbox/)
 *
 * Source Note schema: a `.md` whose YAML frontmatter contains `type: source`
 * (Articles, Books, Reports, Podcasts, Videos, Literature Notes all share
 * this). A Source Note "claims" an item when any frontmatter wikilink
 * `[[Target]]` resolves to that item's filename (with or without extension).
 * Generalises the original `pdf: "[[Foo.pdf]]"` convention.
 *
 * Output shape:
 * {
 *   outstanding_sources: {
 *     count, items_total, source_notes_total,
 *     items: [{ path, name, kind, size_kb, mtime }]
 *   },
 *   reading_queue: {
 *     total, unread, read,
 *     items: [{ slug, kind, added, done }]
 *   },
 *   recent_daily_notes: [{ name, date, mtime, size_bytes }],
 *   recent_inbox:       [{ name, mtime, size_bytes }]
 * }
 */

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { homedir } from 'node:os';

const VAULT = process.env.VAULT_PATH || join(homedir(), 'vaults/PostLiterate');
const SOURCES_DIR = join(VAULT, '01_Sources');
const ARTICLES_DIR = join(VAULT, '01_Sources/Articles');
const READING_QUEUE_PATH = join(VAULT, '01_Sources/READING_QUEUE.md');
const DAILY_DIR = join(VAULT, '06_Meta/Daily');
const INBOX_DIR = join(VAULT, '00_Inbox');
const CONCEPTS_DIR = join(VAULT, '02_Concepts');

// Subfolders of 01_Sources/ whose contents should be tracked as source items.
// `kind` doubles as the display label / badge text in the dashboard UI.
const SOURCE_KIND_DIRS = [
  { kind: 'PDFs',        rel: 'PDFs' },
  { kind: 'Podcasts',    rel: 'Podcasts' },
  { kind: 'Reports',     rel: 'Reports' },
  { kind: 'Clippings',   rel: 'Clippings' },
  { kind: 'Transcripts', rel: 'Transcripts' },
  { kind: 'Videos',      rel: 'Videos' },
];

// Filenames in 01_Sources/ that are infrastructure, not source items.
const ITEM_SKIP_NAMES = new Set(['READING_QUEUE.md', '.DS_Store']);

// ── Filesystem helpers ─────────────────────────────────────────
function safeListFiles(dir, pattern) {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir).filter((name) => {
      if (pattern && !pattern.test(name)) return false;
      try {
        return statSync(join(dir, name)).isFile();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

function fileMeta(dir, name) {
  try {
    const s = statSync(join(dir, name));
    return {
      mtime: new Date(s.mtimeMs).toISOString(),
      size_bytes: s.size,
    };
  } catch {
    return { mtime: null, size_bytes: null };
  }
}

// Read a short preview of a note: strip YAML frontmatter, drop the
// leading H1 (which usually duplicates the filename), strip wikilink
// brackets, then take the first ~maxChars of joined prose. Returns
// null for unreadable or empty files.
function notePreview(filePath, maxChars = 220) {
  let text;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  let body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  // Drop a leading H1 (and any blank lines before it).
  body = body.replace(/^\s*#\s+[^\n]*\n+/, '');
  // Strip simple markdown noise: heading markers, leading list markers,
  // [[wikilinks]] (keep alias if present), bare URLs in inline code.
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
  if (cleaned.length <= maxChars) return cleaned;
  return cleaned.slice(0, maxChars).replace(/\s+\S*$/, '') + '…';
}

// ── Outstanding sources ────────────────────────────────────────
//
// An item is a file (any extension) inside one of SOURCE_KIND_DIRS or a
// loose file in 01_Sources/ root. An item is "outstanding" when no
// `type: source` Source Note's frontmatter wikilinks it.
//
// Source Notes themselves (`.md` with frontmatter `type: source`) are not
// items — they ARE the note. Other `.md` files (e.g. `type: clipping` or
// no frontmatter) ARE items, and stay outstanding until a Source Note is
// written that references them.

// Walk every .md under 01_Sources/ recursively. Returns absolute paths.
function walkAllNotes() {
  const out = [];
  const stack = [SOURCES_DIR];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && /\.md$/i.test(entry.name)) {
        out.push(full);
      }
    }
  }
  return out;
}

// Pull the YAML frontmatter block (between leading ---/---), or null.
function extractFrontmatterBlock(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : null;
}

// True iff frontmatter declares `type: source`. Quotes/spacing tolerant.
function isSourceNote(fmBlock) {
  if (!fmBlock) return false;
  const m = fmBlock.match(/^type\s*:\s*(.*)$/m);
  if (!m) return false;
  const val = m[1].trim().replace(/^["']|["']$/g, '').toLowerCase();
  return val === 'source';
}

// Collect every `[[Target]]` wikilink target appearing anywhere in the
// frontmatter block, regardless of which key it sits under. For each
// target we register both the literal value and its stem (filename
// without final extension), lowercased — this lets us match a Source
// Note that wrote `[[Foo.pdf]]` against an item `Foo.pdf`, and also a
// note that wrote a bare `[[Foo]]` against any extension-mate.
function collectClaimedNames(fmBlock, sink) {
  if (!fmBlock) return;
  for (const match of fmBlock.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
    const target = match[1].trim();
    if (!target) continue;
    sink.add(target.toLowerCase());
    const stem = target.replace(/\.[^./\\]+$/, '');
    if (stem !== target) sink.add(stem.toLowerCase());
  }
}

// True if either the item's full filename or its stem is in the claimed
// set. Names normalized to lowercase before lookup.
function isItemClaimed(filename, claimed) {
  const fn = filename.toLowerCase();
  if (claimed.has(fn)) return true;
  const stem = fn.replace(/\.[^./\\]+$/, '');
  return claimed.has(stem);
}

// List items in a single watched dir (non-recursive). Returns absolute
// paths. Skips dotfiles and infrastructure names.
function listWatchedDir(absDir) {
  if (!existsSync(absDir)) return [];
  let entries;
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((n) => !n.startsWith('.') && !ITEM_SKIP_NAMES.has(n))
    .map((n) => join(absDir, n));
}

function getOutstandingSources() {
  // 1. Find every .md with type:source and harvest claimed wikilink targets.
  const allNotes = walkAllNotes();
  const sourceNotePaths = new Set();
  const claimed = new Set();
  for (const notePath of allNotes) {
    let text;
    try {
      text = readFileSync(notePath, 'utf8');
    } catch {
      continue;
    }
    const fmBlock = extractFrontmatterBlock(text);
    if (!isSourceNote(fmBlock)) continue;
    sourceNotePaths.add(notePath);
    collectClaimedNames(fmBlock, claimed);
  }

  // 2. Enumerate candidate items: each watched subfolder + loose root.
  const candidates = [];
  for (const { kind, rel } of SOURCE_KIND_DIRS) {
    const absDir = join(SOURCES_DIR, rel);
    for (const full of listWatchedDir(absDir)) {
      candidates.push({ full, kind });
    }
  }
  for (const full of listWatchedDir(SOURCES_DIR)) {
    candidates.push({ full, kind: 'Loose' });
  }

  // 3. Filter to items lacking a claiming Source Note. Source Notes
  //    themselves are not items — they ARE the note.
  const items = candidates
    .filter(({ full }) => !sourceNotePaths.has(full))
    .filter(({ full }) => !isItemClaimed(full.split('/').pop(), claimed))
    .map(({ full, kind }) => {
      const name = full.split('/').pop();
      let s;
      try {
        s = statSync(full);
      } catch {
        s = null;
      }
      return {
        path: relative(VAULT, full),
        name,
        kind,
        size_kb: s ? Math.round(s.size / 1024) : null,
        mtime: s ? new Date(s.mtimeMs).toISOString() : null,
      };
    })
    .sort((a, b) => (b.mtime || '').localeCompare(a.mtime || ''));

  return {
    count: items.length,
    items_total: candidates.length,
    source_notes_total: sourceNotePaths.size,
    items,
  };
}

// ── Reading queue ──────────────────────────────────────────────
//
// New line format (post-migration):
//   - [<status>] [[Slug]] — *kind*, added MM-DD-YYYY
// where <status> ∈ READING_STATUSES.
//
// Legacy format `- [ ]` / `- [x]` is still parsed for back-compat;
// any toggle through the API rewrites these to the new format.
// Sort order in the returned items array matches file order; the UI
// re-sorts for display.
//
export const READING_STATUSES = ['to-read', 'reading', 'read', 'finished'];

function parseQueueLine(line) {
  // New format: - [<status>]
  const newFmt = line.match(/^(\s*-\s+\[)([a-z][a-z-]*)(\]\s+\[\[)([^\]]+)(\]\].*)$/i);
  if (newFmt) {
    const status = newFmt[2].toLowerCase();
    if (!READING_STATUSES.includes(status)) return null;
    return { status, slug: newFmt[4].trim(), rest: newFmt[5] };
  }
  // Legacy format: - [ ] / - [x]
  const legacy = line.match(/^(\s*-\s+\[)([ xX])(\]\s+\[\[)([^\]]+)(\]\].*)$/);
  if (legacy) {
    const status = legacy[2].toLowerCase() === 'x' ? 'read' : 'to-read';
    return { status, slug: legacy[4].trim(), rest: legacy[5], legacy: true };
  }
  return null;
}

function getReadingQueue() {
  if (!existsSync(READING_QUEUE_PATH)) {
    return { total: 0, by_status: {}, to_read: 0, in_progress: 0, done: 0, items: [] };
  }

  const text = readFileSync(READING_QUEUE_PATH, 'utf8');
  const items = [];

  for (const line of text.split(/\r?\n/)) {
    const parsed = parseQueueLine(line);
    if (!parsed) continue;

    let kind = null;
    const kindMatch = parsed.rest.match(/\*([^*]+)\*/);
    if (kindMatch) kind = kindMatch[1].trim();

    let added = null;
    const addedMatch = parsed.rest.match(/added\s+(\d{2}-\d{2}-\d{4})/i);
    if (addedMatch) added = addedMatch[1];

    items.push({ slug: parsed.slug, kind, added, status: parsed.status });
  }

  const by_status = Object.fromEntries(READING_STATUSES.map((s) => [s, 0]));
  for (const item of items) by_status[item.status] = (by_status[item.status] || 0) + 1;

  return {
    total: items.length,
    by_status,
    to_read: by_status['to-read'] || 0,
    in_progress: by_status['reading'] || 0,
    done: (by_status['read'] || 0) + (by_status['finished'] || 0),
    items,
  };
}

// ── Recent daily notes ─────────────────────────────────────────
function getRecentDailyNotes(limit = 7) {
  const files = safeListFiles(DAILY_DIR, /^\d{2}-\d{2}-\d{4}\.md$/);
  return files
    .map((name) => {
      const m = name.match(/^(\d{2})-(\d{2})-(\d{4})\.md$/);
      const date = m ? `${m[3]}-${m[1]}-${m[2]}` : null;
      const meta = fileMeta(DAILY_DIR, name);
      return {
        name: name.replace(/\.md$/, ''),
        date,
        mtime: meta.mtime,
        size_bytes: meta.size_bytes,
      };
    })
    .filter((d) => d.date)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
}

// ── Recent concepts ────────────────────────────────────────────
function getRecentConcepts(limit = 6) {
  const files = safeListFiles(CONCEPTS_DIR, /\.md$/);
  return files
    .map((name) => {
      const meta = fileMeta(CONCEPTS_DIR, name);
      return { name, mtime: meta.mtime, size_bytes: meta.size_bytes };
    })
    .sort((a, b) => (b.mtime || '').localeCompare(a.mtime || ''))
    .slice(0, limit)
    .map((entry) => ({
      name: entry.name.replace(/\.md$/, ''),
      mtime: entry.mtime,
      size_bytes: entry.size_bytes,
      preview: notePreview(join(CONCEPTS_DIR, entry.name)),
    }));
}

// ── Recent inbox items ─────────────────────────────────────────
function getRecentInbox(limit = 6) {
  const files = safeListFiles(INBOX_DIR, /\.md$/);
  return files
    .map((name) => {
      const meta = fileMeta(INBOX_DIR, name);
      return { name, mtime: meta.mtime, size_bytes: meta.size_bytes };
    })
    .sort((a, b) => (b.mtime || '').localeCompare(a.mtime || ''))
    .slice(0, limit)
    .map((entry) => ({
      name: entry.name.replace(/\.md$/, ''),
      mtime: entry.mtime,
      size_bytes: entry.size_bytes,
      preview: notePreview(join(INBOX_DIR, entry.name)),
    }));
}

// ── Mutation helpers ───────────────────────────────────────────

function writeArticleStatus(slug, status) {
  const articlePath = join(ARTICLES_DIR, `${slug}.md`);
  if (!existsSync(articlePath)) return { articleExists: false, articleUpdated: false };

  const articleText = readFileSync(articlePath, 'utf8');
  const fmMatch = articleText.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!fmMatch) return { articleExists: true, articleUpdated: false };

  const [head, body, tail] = [fmMatch[1], fmMatch[2], fmMatch[3]];
  const after = articleText.slice(fmMatch[0].length);

  let newBody;
  if (/^status\s*:/m.test(body)) {
    newBody = body.replace(/^status\s*:.*$/m, `status: ${status}`);
  } else {
    newBody = `${body.replace(/\s+$/, '')}\nstatus: ${status}`;
  }

  if (newBody === body) return { articleExists: true, articleUpdated: false };
  writeFileSync(articlePath, head + newBody + tail + after, 'utf8');
  return { articleExists: true, articleUpdated: true };
}

// Read the current `status:` from an article's frontmatter, if any.
function readArticleStatus(slug) {
  const articlePath = join(ARTICLES_DIR, `${slug}.md`);
  if (!existsSync(articlePath)) return null;
  const articleText = readFileSync(articlePath, 'utf8');
  const fm = articleText.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return null;
  const m = fm[1].match(/^status\s*:\s*(.*)$/m);
  if (!m) return null;
  const val = m[1].trim().replace(/^["']|["']$/g, '').toLowerCase();
  return val || null;
}

// Set the `status:` frontmatter of any Source Note by vault-relative path
// (e.g., "01_Sources/Articles/Foo.md" or "01_Sources/Books/Bar.md"). Used by
// the Today panel's reading checklist. Guards against path traversal and
// writes outside 01_Sources/.
export function setSourceNoteStatus(relPath, status) {
  if (typeof relPath !== 'string' || !relPath.startsWith('01_Sources/') || relPath.includes('..')) {
    return { path: relPath, found: false, updated: false, reason: 'invalid path' };
  }
  if (!READING_STATUSES.includes(status)) {
    return { path: relPath, found: false, updated: false, reason: 'invalid status' };
  }
  const abs = join(VAULT, relPath);
  if (!existsSync(abs)) return { path: relPath, found: false, updated: false };

  const text = readFileSync(abs, 'utf8');
  const fm = text.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!fm) return { path: relPath, found: true, updated: false, reason: 'no frontmatter' };

  const [head, body, tail] = [fm[1], fm[2], fm[3]];
  const after = text.slice(fm[0].length);
  const prevMatch = body.match(/^status\s*:\s*(.*)$/m);
  const previous = prevMatch ? prevMatch[1].trim().replace(/^["']|["']$/g, '') : null;

  const newBody = /^status\s*:/m.test(body)
    ? body.replace(/^status\s*:.*$/m, `status: ${status}`)
    : `${body.replace(/\s+$/, '')}\nstatus: ${status}`;

  if (newBody === body) return { path: relPath, found: true, updated: false, status };
  writeFileSync(abs, head + newBody + tail + after, 'utf8');
  return { path: relPath, found: true, updated: true, previous, status };
}

// ── Mutation: set a reading-queue item's status ────────────────
//
// Writes the queue line as `- [<status>] [[Slug]] …` and the matching
// article note's `status:` field. Accepts new-format and legacy lines
// alike; rewrites legacy lines to the new format on touch.
//
export function setReadingQueueItemStatus(slug, status) {
  if (typeof slug !== 'string' || slug.trim() === '') {
    throw new Error('slug is required');
  }
  if (!READING_STATUSES.includes(status)) {
    throw new Error(`status must be one of: ${READING_STATUSES.join(', ')}`);
  }
  if (!existsSync(READING_QUEUE_PATH)) {
    throw new Error('READING_QUEUE.md not found');
  }

  const text = readFileSync(READING_QUEUE_PATH, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  let queueChanged = false;
  let matched = false;

  for (let i = 0; i < lines.length; i++) {
    const newFmt = lines[i].match(/^(\s*-\s+\[)([a-z][a-z-]*)(\]\s+\[\[)([^\]]+)(\]\].*)$/i);
    const legacy = lines[i].match(/^(\s*-\s+\[)([ xX])(\]\s+\[\[)([^\]]+)(\]\].*)$/);
    const m = newFmt || legacy;
    if (!m) continue;
    if (m[4].trim() !== slug) continue;

    matched = true;
    const currentStatus = newFmt
      ? newFmt[2].toLowerCase()
      : legacy[2].toLowerCase() === 'x'
        ? 'read'
        : 'to-read';

    if (currentStatus === status && newFmt) continue; // already in target state, new-format
    lines[i] = `${m[1]}${status}${m[3]}${m[4]}${m[5]}`;
    queueChanged = true;
  }

  if (queueChanged) {
    writeFileSync(READING_QUEUE_PATH, lines.join(eol), 'utf8');
  }

  const article = writeArticleStatus(slug, status);
  return {
    matched,
    queueChanged,
    articleExists: article.articleExists,
    articleUpdated: article.articleUpdated,
  };
}

// ── One-shot migration ─────────────────────────────────────────
//
// Converts every legacy `- [ ]` / `- [x]` line in READING_QUEUE.md to the
// new `- [<status>]` format. For each line, the new status is taken from
// the matching article note's frontmatter when available; otherwise we
// fall back to `to-read` (for `[ ]`) or `read` (for `[x]`).
//
// Idempotent — running twice is a no-op once everything has been migrated.
//
export function migrateReadingQueue() {
  if (!existsSync(READING_QUEUE_PATH)) {
    return { converted: 0, lines: 0 };
  }

  const text = readFileSync(READING_QUEUE_PATH, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  let converted = 0;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*-\s+\[)([ xX])(\]\s+\[\[)([^\]]+)(\]\].*)$/);
    if (!m) continue;
    const slug = m[4].trim();
    const fallback = m[2].toLowerCase() === 'x' ? 'read' : 'to-read';
    const articleStatus = readArticleStatus(slug);
    const status =
      articleStatus && READING_STATUSES.includes(articleStatus) ? articleStatus : fallback;
    lines[i] = `${m[1]}${status}${m[3]}${m[4]}${m[5]}`;
    converted++;
  }

  // Refresh the help-text line so its instructions match the new format.
  for (let i = 0; i < lines.length; i++) {
    if (
      lines[i].startsWith('Sources added but not yet read.') ||
      lines[i].startsWith('Sources tracked here.')
    ) {
      lines[i] =
        'Sources tracked here. Update status from the dashboard, or edit the bracketed status (`to-read` / `reading` / `read` / `finished`) in place.';
      break;
    }
  }

  if (converted > 0) {
    writeFileSync(READING_QUEUE_PATH, lines.join(eol), 'utf8');
  }
  return { converted, lines: lines.length };
}

// ── Main export ────────────────────────────────────────────────
export async function getVaultWatch() {
  return {
    outstanding_sources: getOutstandingSources(),
    reading_queue: getReadingQueue(),
    recent_daily_notes: getRecentDailyNotes(),
    recent_concepts: getRecentConcepts(),
    recent_inbox: getRecentInbox(),
  };
}

/**
 * vault-watch.mjs — Phase 3
 *
 * Surfaces "what needs attention in the vault":
 *   - Outstanding sources: PDFs in 01_Sources/PDFs/ with no Article note linking them
 *   - Reading queue: parsed from 01_Sources/READING_QUEUE.md
 *   - Recent daily notes (06_Meta/Daily/)
 *   - Recent inbox items (00_Inbox/)
 *
 * Article notes link to PDFs via frontmatter `pdf: "[[Filename.pdf]]"`.
 * Anything in 01_Sources/PDFs/ that isn't referenced that way is "outstanding".
 *
 * Output shape:
 * {
 *   outstanding_sources: {
 *     count, pdfs_total, articles_total,
 *     items: [{ pdf, size_kb, mtime }]
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
import { join } from 'node:path';
import { homedir } from 'node:os';

const VAULT = process.env.VAULT_PATH || join(homedir(), 'vaults/PostLiterate');
const SOURCES_DIR = join(VAULT, '01_Sources');
const PDFS_DIR = join(VAULT, '01_Sources/PDFs');
const ARTICLES_DIR = join(VAULT, '01_Sources/Articles');
const READING_QUEUE_PATH = join(VAULT, '01_Sources/READING_QUEUE.md');
const DAILY_DIR = join(VAULT, '06_Meta/Daily');
const INBOX_DIR = join(VAULT, '00_Inbox');
const CONCEPTS_DIR = join(VAULT, '02_Concepts');

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
// A source note "claims" a PDF when its frontmatter has
//   pdf: "[[Filename.pdf]]"
// (or a bare/quoted filename ending in .pdf). We walk every .md file
// under 01_Sources/ except the PDFs/ subdir itself — so notes in
// Articles/, Books/, Reports/, Podcasts/, Videos/, Transcripts/,
// Literature Notes/, Clippings/, and any future subfolders all count.
//
function walkSourceNotes() {
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
      if (entry.name === 'PDFs') continue; // never recurse into the PDFs leaf
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

function extractLinkedPdf(text) {
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return null;
  const pdfLine = fm[1].match(/^pdf\s*:\s*(.*)$/m);
  if (!pdfLine) return null;
  const val = pdfLine[1].trim();
  if (!val) return null;
  const wikilink = val.match(/\[\[([^\]]+\.pdf)\]\]/i);
  if (wikilink) return wikilink[1].trim();
  const cleaned = val.replace(/^["']|["']$/g, '').trim();
  if (cleaned.toLowerCase().endsWith('.pdf')) return cleaned;
  return null;
}

function getOutstandingSources() {
  const pdfs = safeListFiles(PDFS_DIR, /\.pdf$/i);
  const sourceNotes = walkSourceNotes();

  const linked = new Set();
  for (const notePath of sourceNotes) {
    let text;
    try {
      text = readFileSync(notePath, 'utf8');
    } catch {
      continue;
    }
    const linkedPdf = extractLinkedPdf(text);
    if (linkedPdf) linked.add(linkedPdf);
  }

  const items = pdfs
    .filter((name) => !linked.has(name))
    .map((name) => {
      const m = fileMeta(PDFS_DIR, name);
      return {
        pdf: name,
        size_kb: m.size_bytes != null ? Math.round(m.size_bytes / 1024) : null,
        mtime: m.mtime,
      };
    })
    .sort((a, b) => (b.mtime || '').localeCompare(a.mtime || ''));

  return {
    count: items.length,
    pdfs_total: pdfs.length,
    source_notes_total: sourceNotes.length,
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

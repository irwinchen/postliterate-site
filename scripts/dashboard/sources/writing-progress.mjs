/**
 * writing-progress.mjs — Phase 4
 *
 * Word/file counts across four series, plus daily archive + 30-day
 * sparkline data:
 *   - cards: 06_Meta/Book/Cards/*.md
 *   - blog:  src/content/blog/*.mdx (published) + 07_Blog/*.md (drafts)
 *   - daily: 06_Meta/Daily/*.md
 *   - ideas: 00_Inbox/*.md + 01_Sources/Literature Notes/*.md
 *
 * Each refresh writes one archive file per day at
 * scripts/dashboard/snapshots/writing/YYYY-MM-DD.json (overwritten if
 * today's file already exists). Sparklines are reconstructed by reading
 * the last 30 days of archives. Archives live outside git (see .gitignore).
 */

import {
  readFileSync,
  readdirSync,
  statSync,
  existsSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '../../..');

const VAULT = process.env.VAULT_PATH || join(homedir(), 'vaults/PostLiterate');
const CARDS_DIR = join(VAULT, '06_Meta/Book/Cards');
const VAULT_BLOG_DIR = join(VAULT, '07_Blog');
const DAILY_DIR = join(VAULT, '06_Meta/Daily');
const INBOX_DIR = join(VAULT, '00_Inbox');
const LIT_NOTES_DIR = join(VAULT, '01_Sources/Literature Notes');
const SITE_BLOG_DIR = join(REPO_ROOT, 'src/content/blog');

const ARCHIVE_DIR = join(__dirname, '../snapshots/writing');

// ── Word counting ──────────────────────────────────────────────
//
// Strips YAML frontmatter (so `title: ...` etc. don't pad the count),
// then counts whitespace-delimited tokens. Code blocks are intentionally
// counted — they're real content for the trend.
//
function wordCount(text) {
  const noFm = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  if (!noFm.trim()) return 0;
  return noFm.trim().split(/\s+/).filter(Boolean).length;
}

// ── Per-directory counter ──────────────────────────────────────
function countDir(dir, pattern = /\.(md|mdx)$/) {
  if (!existsSync(dir)) return { files: 0, words: 0 };
  let files = 0;
  let words = 0;
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return { files: 0, words: 0 };
  }
  for (const name of names) {
    if (!pattern.test(name)) continue;
    const p = join(dir, name);
    try {
      const st = statSync(p);
      if (!st.isFile()) continue;
      files++;
      words += wordCount(readFileSync(p, 'utf8'));
    } catch {
      /* skip unreadable */
    }
  }
  return { files, words };
}

// ── Blog (published + drafts, distinguished) ──────────────────
//
// "Published" = files in the site's content collection (`src/content/blog/*.mdx`).
// "Draft"     = files in vault `07_Blog/*.md` whose stem isn't already published.
//
function countBlog() {
  const published = countDir(SITE_BLOG_DIR, /\.mdx$/);

  const publishedStems = new Set();
  if (existsSync(SITE_BLOG_DIR)) {
    try {
      for (const name of readdirSync(SITE_BLOG_DIR)) {
        if (name.endsWith('.mdx')) publishedStems.add(name.replace(/\.mdx$/, ''));
      }
    } catch {
      /* ignore */
    }
  }

  let draftFiles = 0;
  let draftWords = 0;
  if (existsSync(VAULT_BLOG_DIR)) {
    let names;
    try {
      names = readdirSync(VAULT_BLOG_DIR);
    } catch {
      names = [];
    }
    for (const name of names) {
      if (!/\.(md|mdx)$/.test(name)) continue;
      const stem = name.replace(/\.(md|mdx)$/, '');
      if (publishedStems.has(stem)) continue;
      const p = join(VAULT_BLOG_DIR, name);
      try {
        const st = statSync(p);
        if (!st.isFile()) continue;
        draftFiles++;
        draftWords += wordCount(readFileSync(p, 'utf8'));
      } catch {
        /* skip */
      }
    }
  }

  return {
    files: published.files + draftFiles,
    words: published.words + draftWords,
    published_files: published.files,
    published_words: published.words,
    draft_files: draftFiles,
    draft_words: draftWords,
  };
}

function countIdeas() {
  const inbox = countDir(INBOX_DIR, /\.md$/);
  const lit = countDir(LIT_NOTES_DIR, /\.md$/);
  return {
    files: inbox.files + lit.files,
    words: inbox.words + lit.words,
    inbox_files: inbox.files,
    inbox_words: inbox.words,
    literature_files: lit.files,
    literature_words: lit.words,
  };
}

// ── Archive + sparkline read ──────────────────────────────────
function archiveCounts(today, counts) {
  mkdirSync(ARCHIVE_DIR, { recursive: true });
  const path = join(ARCHIVE_DIR, `${today}.json`);
  writeFileSync(
    path,
    JSON.stringify({ date: today, captured_at: new Date().toISOString(), counts }, null, 2),
    'utf8'
  );
}

function dateNDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function readSparklines(days = 30) {
  const empty = { dates: [], cards: [], blog: [], daily: [], ideas: [] };
  if (!existsSync(ARCHIVE_DIR)) return empty;

  let names;
  try {
    names = readdirSync(ARCHIVE_DIR);
  } catch {
    return empty;
  }

  const cutoff = dateNDaysAgo(days - 1);
  const dated = names
    .filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n))
    .map((n) => n.replace(/\.json$/, ''))
    .filter((d) => d >= cutoff)
    .sort();

  const series = { dates: [], cards: [], blog: [], daily: [], ideas: [] };
  for (const date of dated) {
    try {
      const data = JSON.parse(readFileSync(join(ARCHIVE_DIR, `${date}.json`), 'utf8'));
      const c = data.counts || {};
      series.dates.push(date);
      series.cards.push(c.cards?.words ?? 0);
      series.blog.push(c.blog?.words ?? 0);
      series.daily.push(c.daily?.words ?? 0);
      series.ideas.push(c.ideas?.words ?? 0);
    } catch {
      /* skip malformed */
    }
  }
  return series;
}

// Compute change over the last N days (current - oldest in window).
// Returns null if there's only one data point.
function delta(series, days) {
  if (!series || series.length < 2) return null;
  const current = series[series.length - 1];
  const window = series.slice(-Math.min(days, series.length));
  const oldest = window[0];
  return current - oldest;
}

// ── Main export ────────────────────────────────────────────────
export async function getWritingProgress() {
  const today = new Date().toISOString().slice(0, 10);

  const counts = {
    cards: countDir(CARDS_DIR, /\.md$/),
    blog: countBlog(),
    daily: countDir(DAILY_DIR, /\.md$/),
    ideas: countIdeas(),
  };

  archiveCounts(today, counts);
  const sparklines = readSparklines(30);

  const deltas = {
    cards: { d7: delta(sparklines.cards, 7), d30: delta(sparklines.cards, 30) },
    blog: { d7: delta(sparklines.blog, 7), d30: delta(sparklines.blog, 30) },
    daily: { d7: delta(sparklines.daily, 7), d30: delta(sparklines.daily, 30) },
    ideas: { d7: delta(sparklines.ideas, 7), d30: delta(sparklines.ideas, 30) },
  };

  return {
    captured_at: new Date().toISOString(),
    today,
    counts,
    sparklines,
    deltas,
  };
}

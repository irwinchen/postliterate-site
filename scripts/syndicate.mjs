#!/usr/bin/env node

/**
 * POSSE syndication step for postliterate.org.
 *
 * Publish Own Site, Syndicate Elsewhere. Posts are published here first
 * (the canonical copy); this script then pushes an *excerpt* with a link
 * back to Mastodon and Bluesky.
 *
 * IMPORTANT: This is a SEPARATE step that runs AFTER deploy, never part of
 * the build/deploy pipeline. It must only run once the canonical URL is
 * actually live, because that URL is what every syndicated post links to.
 * Typical flow:  npm run build → deploy (push to main → Vercel) → npm run syndicate
 *
 * Usage:
 *   npm run syndicate                       # all eligible posts, all targets
 *   npm run syndicate -- --dry-run          # print what would post; no network, no writes
 *   npm run syndicate -- --slug=my-path-to-ai
 *   npm run syndicate -- --only=mastodon
 *   npm run syndicate -- --only=mastodon,bluesky
 *
 * Eligibility: a post is syndicated to a target when
 *   1. status === 'published'
 *   2. frontmatter `syndicate` array includes that target
 *   3. the slug+target pair is not already recorded in .syndication/log.json
 *
 * Secrets come from .env (see .env.example). The ledger at .syndication/log.json
 * is committed so idempotency survives across machines and runs.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import yaml from 'js-yaml';
import { AtpAgent, RichText } from '@atproto/api';

// Slug derivation is single-sourced from the site itself so syndicated links
// always match the real route. Node strips the TS types at import time.
import { postSlug } from '../src/utils.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BLOG_DIR = join(ROOT, 'src/content/blog');
const LEDGER_DIR = join(ROOT, '.syndication');
const LEDGER_PATH = join(LEDGER_DIR, 'log.json');

const VALID_TARGETS = ['mastodon', 'bluesky'];
const BLUESKY_GRAPHEME_LIMIT = 300;
const ELLIPSIS = '…';

// ── tiny .env loader (no dependency) ─────────────────────────────────────
function loadEnv() {
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, 'utf8');
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

// ── arg parsing ──────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { dryRun: false, slug: null, only: null };
  for (const arg of argv) {
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg.startsWith('--slug=')) args.slug = arg.slice('--slug='.length).trim();
    else if (arg.startsWith('--only=')) {
      args.only = arg
        .slice('--only='.length)
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    } else {
      console.warn(`⚠️  Unknown argument ignored: ${arg}`);
    }
  }
  return args;
}

// ── frontmatter + body parsing ───────────────────────────────────────────
function parsePost(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;
  let data;
  try {
    data = yaml.load(match[1]) || {};
  } catch (err) {
    throw new Error(`Invalid frontmatter in ${basename(filePath)}: ${err.message}`);
  }
  return { data, body: match[2] };
}

/** Best-effort first prose paragraph, with light markdown stripping. */
function firstParagraph(body) {
  const lines = body.split('\n');
  const para = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (para.length) break; // blank line ends the first paragraph
      continue; // skip leading blanks
    }
    // Skip non-prose scaffolding before the first paragraph.
    if (/^import\s/.test(line)) continue;
    if (/^export\s/.test(line)) continue;
    if (line.startsWith('#')) continue; // headings
    if (line.startsWith('<')) continue; // JSX / HTML component lines
    if (line.startsWith('>')) continue; // blockquotes / callouts
    if (line.startsWith('---') || line.startsWith('***')) continue; // rules
    para.push(line);
  }
  let text = para.join(' ');
  // Light inline-markdown cleanup so the blurb reads as plain text.
  text = text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → text
    .replace(/`([^`]*)`/g, '$1') // inline code
    .replace(/(\*\*|__)(.*?)\1/g, '$2') // bold
    .replace(/(\*|_)(.*?)\1/g, '$2') // italic
    .replace(/\s+/g, ' ')
    .trim();
  return text;
}

function resolveExcerpt(data, body) {
  if (typeof data.excerpt === 'string' && data.excerpt.trim()) return data.excerpt.trim();
  if (typeof data.description === 'string' && data.description.trim()) return data.description.trim();
  const para = firstParagraph(body);
  return para || '';
}

// ── grapheme helpers (links count toward Bluesky's 300 limit) ─────────────
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
function graphemes(str) {
  return [...segmenter.segment(str)].map((s) => s.segment);
}
function graphemeLength(str) {
  return graphemes(str).length;
}

/**
 * Build Bluesky post text: excerpt + "\n" + url, within 300 graphemes.
 * Never truncates the URL — only the excerpt, with an ellipsis appended.
 */
function buildBlueskyText(excerpt, url) {
  const suffix = '\n' + url;
  const full = excerpt + suffix;
  if (graphemeLength(full) <= BLUESKY_GRAPHEME_LIMIT) return full;

  // Budget left for the excerpt once the URL, newline, and ellipsis are reserved.
  const reserved = graphemeLength(suffix) + graphemeLength(ELLIPSIS);
  const budget = BLUESKY_GRAPHEME_LIMIT - reserved;
  if (budget <= 0) {
    // Pathological: URL alone fills the limit. Post just the URL.
    return url;
  }
  let kept = graphemes(excerpt).slice(0, budget).join('').trimEnd();
  return kept + ELLIPSIS + suffix;
}

// ── ledger ───────────────────────────────────────────────────────────────
function loadLedger() {
  if (!existsSync(LEDGER_PATH)) return {};
  try {
    return JSON.parse(readFileSync(LEDGER_PATH, 'utf8')) || {};
  } catch (err) {
    throw new Error(`Could not parse ledger ${LEDGER_PATH}: ${err.message}`);
  }
}

function saveLedger(ledger) {
  if (!existsSync(LEDGER_DIR)) mkdirSync(LEDGER_DIR, { recursive: true });
  // Stable key ordering keeps committed diffs minimal.
  const ordered = {};
  for (const key of Object.keys(ledger).sort()) ordered[key] = ledger[key];
  writeFileSync(LEDGER_PATH, JSON.stringify(ordered, null, 2) + '\n');
}

// ── platform posters ─────────────────────────────────────────────────────
async function postToMastodon({ excerpt, url, slug }) {
  const instance = (process.env.MASTODON_INSTANCE || '').replace(/\/+$/, '');
  const token = process.env.MASTODON_ACCESS_TOKEN;
  if (!instance) throw new Error('MASTODON_INSTANCE is not set');
  if (!token) throw new Error('MASTODON_ACCESS_TOKEN is not set');

  const status = `${excerpt}\n\n${url}`;
  const res = await fetch(`${instance}/api/v1/statuses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      // Slug-keyed so a retry after a crash doesn't double-post.
      'Idempotency-Key': slug,
    },
    body: JSON.stringify({ status }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`);
  }
  const json = await res.json();
  return { id: String(json.id), url: json.url, at: new Date().toISOString() };
}

async function postToBluesky({ excerpt, url, title }) {
  const identifier = process.env.BLUESKY_IDENTIFIER;
  const appPassword = process.env.BLUESKY_APP_PASSWORD;
  if (!identifier) throw new Error('BLUESKY_IDENTIFIER is not set');
  if (!appPassword) throw new Error('BLUESKY_APP_PASSWORD is not set');

  const agent = new AtpAgent({ service: 'https://bsky.social' });
  await agent.login({ identifier, password: appPassword });

  const text = buildBlueskyText(excerpt, url);

  // Detect facets so the URL renders as a real link.
  const rt = new RichText({ text });
  await rt.detectFacets(agent);

  // Link card. Description uses the full excerpt (thumbnail intentionally skipped).
  const embed = {
    $type: 'app.bsky.embed.external',
    external: {
      uri: url,
      title: title || url,
      description: excerpt,
    },
  };

  const res = await agent.post({
    text: rt.text,
    facets: rt.facets,
    embed,
    createdAt: new Date().toISOString(),
  });

  return { uri: res.uri, cid: res.cid, at: new Date().toISOString() };
}

// ── main ─────────────────────────────────────────────────────────────────
async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));

  // Resolve the active target set (--only narrows it).
  let targets = VALID_TARGETS;
  if (args.only) {
    const invalid = args.only.filter((t) => !VALID_TARGETS.includes(t));
    if (invalid.length) {
      console.error(`✖ Invalid --only target(s): ${invalid.join(', ')}. Valid: ${VALID_TARGETS.join(', ')}`);
      process.exit(2);
    }
    targets = args.only;
  }

  const siteUrl = (process.env.SITE_URL || '').replace(/\/+$/, '');
  if (!siteUrl && !args.dryRun) {
    console.error('✖ SITE_URL is not set. Add it to .env (see .env.example).');
    process.exit(2);
  }
  const baseUrl = siteUrl || 'https://postliterate.org'; // dry-run fallback for display

  // Gather candidate posts.
  const files = readdirSync(BLOG_DIR).filter((f) => /\.mdx?$/.test(f));
  const ledger = loadLedger();

  let anyFailed = false;
  let anyPosted = false;
  let considered = 0;

  console.log(`\n📡 POSSE syndication${args.dryRun ? ' (DRY RUN — no network, no writes)' : ''}`);
  console.log(`   site: ${baseUrl}   targets: ${targets.join(', ')}\n`);

  for (const file of files) {
    let parsed;
    try {
      parsed = parsePost(join(BLOG_DIR, file));
    } catch (err) {
      console.error(`✖ ${file}: ${err.message}`);
      anyFailed = true;
      continue;
    }
    if (!parsed) continue;

    const { data, body } = parsed;
    const slug = postSlug(file);

    if (args.slug && slug !== args.slug) continue;
    if (data.status !== 'published') continue;

    const wanted = Array.isArray(data.syndicate) ? data.syndicate : [];
    const postTargets = targets.filter((t) => wanted.includes(t));
    if (postTargets.length === 0) continue;

    considered++;
    const title = data.title || slug;
    const excerpt = resolveExcerpt(data, body);
    const url = `${baseUrl}/blog/${slug}`;

    console.log(`• ${slug}  —  ${title}`);

    if (!excerpt) {
      console.log(`    ⚠️  no excerpt/description/first-paragraph available; skipping all targets`);
      anyFailed = true;
      continue;
    }

    const entry = ledger[slug] || {};

    for (const target of postTargets) {
      if (entry[target]) {
        const ref = target === 'mastodon' ? entry[target].url : entry[target].uri;
        console.log(`    ↷ ${target}: skipped (already syndicated → ${ref})`);
        continue;
      }

      if (args.dryRun) {
        if (target === 'mastodon') {
          const status = `${excerpt}\n\n${url}`;
          console.log(`    ◌ mastodon: would post (${graphemeLength(status)} chars):`);
          console.log(indent(status));
        } else {
          const text = buildBlueskyText(excerpt, url);
          console.log(`    ◌ bluesky: would post (${graphemeLength(text)} graphemes):`);
          console.log(indent(text));
          console.log(`      + link card → title: ${JSON.stringify(title)}`);
        }
        continue;
      }

      try {
        let result;
        if (target === 'mastodon') {
          result = await postToMastodon({ excerpt, url, slug });
          console.log(`    ✔ mastodon: posted → ${result.url}`);
        } else {
          result = await postToBluesky({ excerpt, url, title });
          console.log(`    ✔ bluesky: posted → ${result.uri}`);
        }
        // Only record on success, so failures retry on the next run.
        entry[target] = result;
        ledger[slug] = entry;
        saveLedger(ledger);
        anyPosted = true;
      } catch (err) {
        console.error(`    ✖ ${target}: failed — ${err.message}`);
        anyFailed = true;
        // Deliberately do NOT write the ledger; the other target still runs.
      }
    }
  }

  if (considered === 0) {
    console.log('No eligible posts found.');
  }

  console.log('');
  if (args.dryRun) {
    console.log('Dry run complete. No posts were sent and the ledger was not modified.');
  } else if (anyPosted) {
    console.log('Done. Ledger updated at .syndication/log.json (commit it).');
  } else {
    console.log('Done. Nothing new to syndicate.');
  }

  process.exit(anyFailed ? 1 : 0);
}

function indent(text) {
  return text
    .split('\n')
    .map((l) => `        ${l}`)
    .join('\n');
}

main().catch((err) => {
  console.error(`✖ Fatal: ${err.stack || err.message}`);
  process.exit(1);
});

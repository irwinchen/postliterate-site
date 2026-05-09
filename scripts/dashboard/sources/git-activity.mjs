/**
 * git-activity.mjs — Phase 6 (Slice 1)
 *
 * Reads git log from the site repo and the vault over the last 7 days,
 * groups commits by date, and (when Ollama is available) generates a
 * one-paragraph summary per day. Falls back to raw commit lines when
 * the LLM isn't reachable.
 *
 * Output shape:
 * {
 *   ollama_available: boolean,
 *   model: "gemma3:12b" | null,
 *   days: [
 *     {
 *       date: "2026-05-08",
 *       commits: [{ repo, sha, author, date, subject }],
 *       summary: "..." | null,    // null if Ollama unavailable
 *     }
 *   ]
 * }
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { isAvailable, getOllamaConfig } from '../lib/ollama.mjs';
import { summarize } from '../lib/summary-cache.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITE_REPO = join(__dirname, '../../..');
const VAULT = process.env.VAULT_PATH || join(homedir(), 'vaults/PostLiterate');

const DAYS_BACK = 7;

// ── git log reader ──────────────────────────────────────────────
function readGitLog(repoPath, label) {
  if (!existsSync(join(repoPath, '.git'))) return [];
  try {
    const out = execFileSync(
      'git',
      [
        '-C',
        repoPath,
        'log',
        `--since=${DAYS_BACK}.days`,
        '--no-merges',
        // Stable separator-delimited format: sha|iso-date|author|subject
        '--pretty=format:%h\x1f%aI\x1f%an\x1f%s',
      ],
      { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }
    );
    if (!out.trim()) return [];
    return out
      .split('\n')
      .map((line) => {
        const [sha, iso, author, subject] = line.split('\x1f');
        if (!sha || !iso) return null;
        return {
          repo: label,
          sha,
          date: iso.slice(0, 10),
          iso,
          author,
          subject: subject || '',
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// ── Group by date ────────────────────────────────────────────────
function groupByDay(commits) {
  const byDate = new Map();
  for (const c of commits) {
    if (!byDate.has(c.date)) byDate.set(c.date, []);
    byDate.get(c.date).push(c);
  }
  // Sort dates desc (newest first); commits within a day sorted by iso desc.
  return [...byDate.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, list]) => ({
      date,
      commits: list.sort((a, b) => b.iso.localeCompare(a.iso)),
    }));
}

// ── Prompt builder ───────────────────────────────────────────────
const SYSTEM_PROMPT =
  "You summarize a single day of git commits across two repos for a writing+coding project called 'After the Book'. " +
  "The repos are: 'site' (a public-facing Astro/Vercel site for postliterate.org) and 'vault' (an Obsidian vault holding book drafts, daily notes, and source notes). " +
  "Focus on what was built, refactored, or written. Group related commits. Skip mechanical noise like merges, formatting, or version bumps. " +
  "Output 1–3 short bullets, plain prose, no preamble, no headers, no quoting commit hashes.";

function buildPrompt(date, commits) {
  const lines = commits.map((c) => `- [${c.repo}] ${c.subject}`).join('\n');
  return `Date: ${date}\n\nCommits:\n${lines}`;
}

// ── Main export ─────────────────────────────────────────────────
export async function getGitActivity() {
  const cfg = getOllamaConfig();
  const ollamaUp = await isAvailable();

  const allCommits = [
    ...readGitLog(SITE_REPO, 'site'),
    ...readGitLog(VAULT, 'vault'),
  ];

  const grouped = groupByDay(allCommits);
  const days = [];

  for (const day of grouped) {
    let dayLabel = null;
    if (ollamaUp && day.commits.length > 0) {
      dayLabel = await summarize({
        system: SYSTEM_PROMPT,
        prompt: buildPrompt(day.date, day.commits),
        label: `git-${day.date}`,
      });
    }
    days.push({
      date: day.date,
      commits: day.commits,
      summary: dayLabel,
    });
  }

  return {
    ollama_available: ollamaUp,
    model: cfg.model,
    days,
  };
}

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

// Detailed window (commits list + Ollama summaries per day).
const DAYS_BACK = 7;
// Heatmap window — counts only, no per-day summary work. 12 weeks shows
// the medium-term rhythm without blowing up Ollama call count.
const HEATMAP_DAYS = Number(process.env.GIT_HEATMAP_DAYS) || 84;

// ── git log reader ──────────────────────────────────────────────
function readGitLog(repoPath, label, daysBack = DAYS_BACK) {
  if (!existsSync(join(repoPath, '.git'))) return [];
  try {
    const out = execFileSync(
      'git',
      [
        '-C',
        repoPath,
        'log',
        `--since=${daysBack}.days`,
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
  "Focus on what was built, refactored, or written. Group related commits. Skip mechanical noise like merges, formatting, or version bumps.\n\n" +
  "Output exactly 1–3 markdown bullets, ONE PER LINE, each starting with '- ' (dash + space). " +
  "Each bullet is one short sentence. No preamble, no headers, no commit hashes, no asterisks.";

function buildPrompt(date, commits) {
  const lines = commits.map((c) => `- [${c.repo}] ${c.subject}`).join('\n');
  return `Date: ${date}\n\nCommits:\n${lines}`;
}

// ── Heatmap builder — fills HEATMAP_DAYS days back, including zeros ─
function buildHeatmap(commitsByDay) {
  // Inclusive window: today + (HEATMAP_DAYS - 1) days back.
  // Use local-date math so the rightmost square is "today" in the user's
  // timezone (not UTC) — otherwise a refresh in the morning could shift
  // by one day depending on TZ.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const buckets = [];
  for (let i = HEATMAP_DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const date = `${yyyy}-${mm}-${dd}`;
    const dayOfWeek = d.getDay(); // 0 = Sun … 6 = Sat
    const list = commitsByDay.get(date) || [];
    const siteCount = list.filter((c) => c.repo === 'site').length;
    const vaultCount = list.filter((c) => c.repo === 'vault').length;
    buckets.push({
      date,
      day_of_week: dayOfWeek,
      count: list.length,
      site_count: siteCount,
      vault_count: vaultCount,
      // Lightweight commit list for click-expand (no Ollama summary —
      // those are kept in `days` for the recent window only).
      commits: list.map((c) => ({ repo: c.repo, sha: c.sha, subject: c.subject })),
    });
  }
  return buckets;
}

// ── Main export ─────────────────────────────────────────────────
export async function getGitActivity() {
  const cfg = getOllamaConfig();
  const ollamaUp = await isAvailable();

  // Pull the longer heatmap window once; the recent-7 view is just a
  // filter over the same data.
  const allCommits = [
    ...readGitLog(SITE_REPO, 'site', HEATMAP_DAYS),
    ...readGitLog(VAULT, 'vault', HEATMAP_DAYS),
  ];

  const commitsByDay = new Map();
  for (const c of allCommits) {
    if (!commitsByDay.has(c.date)) commitsByDay.set(c.date, []);
    commitsByDay.get(c.date).push(c);
  }

  const heatmap = buildHeatmap(commitsByDay);

  // Detailed days = last DAYS_BACK that have commits, with Ollama
  // summaries (cached). Heatmap covers the longer window; this stays
  // bounded so we don't run 84 LLM calls per refresh.
  const cutoffMs = Date.now() - DAYS_BACK * 24 * 60 * 60 * 1000;
  const recentCommits = allCommits.filter((c) => new Date(c.iso).getTime() >= cutoffMs);
  const grouped = groupByDay(recentCommits);
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
    heatmap_window_days: HEATMAP_DAYS,
    heatmap,
    days,
  };
}

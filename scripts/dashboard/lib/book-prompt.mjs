/**
 * book-prompt.mjs — daily, content-aware writing prompt for the Today panel.
 *
 * Hybrid generation:
 *   1. Deterministically find the beat that needs the most work in the current
 *      working chapter — by comparing what's been drafted (per-section word
 *      counts) against what the chapter still needs (evidence-matrix GAP/DIGEST
 *      items, or a beats list, or just the draft's own section headings).
 *   2. Have the LLM phrase a sharp one-line prompt aimed at that beat, given the
 *      draft breakdown + recent daily output.
 *   3. Fall back to a deterministic, still-targeted prompt when no LLM is
 *      reachable (which is the normal state on the author's MacBook).
 *
 * "Both" chapter-map source: evidence matrix when one exists, otherwise a beats
 * list from book-plan.json, otherwise the draft's own ## headings.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { summarize } from './summary-cache.mjs';
import { isAvailable } from './ollama.mjs';

// Words below which a section reads as "needs fleshing out". Only used for the
// gap ranking, not a hard target.
const SECTION_FLOOR = 350;

function norm(s) {
  return (s || '')
    .toLowerCase()
    .replace(/^§?\s*\d+\s*/, '')        // drop a leading §N / N
    .replace(/\([^)]*\)/g, ' ')          // drop parentheticals
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleMatch(a, b) {
  const na = norm(a);
  const nb = norm(b);
  return !!na && !!nb && (na === nb || na.includes(nb) || nb.includes(na));
}

// Prose word counts per level-2 (##) section of a markdown draft.
export function sectionWordCounts(md) {
  const t = (md || '')
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')   // frontmatter
    .replace(/<!--[\s\S]*?-->/g, ' ');                // HTML comments
  const sections = [];
  let cur = null;
  for (const line of t.split(/\r?\n/)) {
    const h2 = line.match(/^##\s+(.*\S)\s*$/);
    if (h2) { cur = { title: h2[1].trim(), words: 0 }; sections.push(cur); continue; }
    if (/^#{1,6}\s/.test(line)) continue;              // any other heading line
    const words = line.trim().split(/\s+/).filter(Boolean).length;
    if (cur) cur.words += words;
  }
  return sections;
}

// Parse an evidence matrix: each `## §N Title` with a Claim|Backing|State|Action
// table → { title, gaps, digests, actions[] } (actions for unresolved rows).
export function parseMatrix(md) {
  const out = [];
  let cur = null;
  for (const line of (md || '').split(/\r?\n/)) {
    const h = line.match(/^##\s+(§\S+.*\S)\s*$/);
    if (h) { cur = { title: h[1].replace(/^§\S+\s*/, '').trim(), gaps: 0, digests: 0, actions: [] }; out.push(cur); continue; }
    if (/^##\s/.test(line)) { cur = null; continue; }   // a non-§ section ends the chapter map
    if (!cur || !/^\s*\|/.test(line)) continue;
    const cells = line.split('|').map((c) => c.trim());
    if (cells.some((c) => /^:?-{2,}:?$/.test(c))) continue;   // separator row
    if (/claim/i.test(cells[1] || '')) continue;              // header row
    const state = (cells[3] || '').toUpperCase();
    const action = cells[4] && cells[4] !== '—' ? cells[4] : '';
    if (state.includes('GAP')) { cur.gaps++; if (action) cur.actions.push(action); }
    else if (state.includes('DIGEST')) { cur.digests++; if (action) cur.actions.push(action); }
  }
  return out;
}

// Merge the "needs" map with the draft's actual word counts.
function buildBeats(matrixSections, draftSections, beatsFallback) {
  if (matrixSections && matrixSections.length) {
    return matrixSections.map((ms) => {
      const d = draftSections.find((ds) => titleMatch(ds.title, ms.title));
      return { title: ms.title, words: d ? d.words : 0, gaps: ms.gaps, digests: ms.digests, actions: ms.actions };
    });
  }
  if (beatsFallback && beatsFallback.length) {
    return beatsFallback.map((b) => {
      const title = typeof b === 'string' ? b : (b.heading || b.title || '');
      const d = draftSections.find((ds) => titleMatch(ds.title, title));
      const actions = typeof b === 'object' && b.prompt ? [b.prompt] : [];
      return { title, words: d ? d.words : 0, gaps: 0, digests: 0, actions };
    });
  }
  return (draftSections || []).map((ds) => ({ title: ds.title, words: ds.words, gaps: 0, digests: 0, actions: [] }));
}

// The beat that needs the most work: thinnest, boosted by unresolved evidence.
function pickTarget(beats) {
  if (!beats.length) return null;
  const score = (b) => Math.min(b.words, SECTION_FLOOR) - 60 * b.gaps - 25 * b.digests;
  return beats.slice().sort((a, b) => score(a) - score(b))[0];
}

function fallbackText(target, weekPrompt) {
  if (target) {
    if (target.actions && target.actions.length) {
      return `Work on “${target.title}” today — ${target.actions[0]}`;
    }
    return weekPrompt
      ? `${weekPrompt} (Thinnest section right now: “${target.title}”.)`
      : `Flesh out “${target.title}” today — it’s the least-developed part of the chapter.`;
  }
  return weekPrompt || '';
}

/**
 * Build today's prompt for a chapter. Returns
 *   { text, section, source: 'llm'|'fallback', generated_for }
 * Always returns a usable `text`.
 */
export async function getDailyPrompt({ vault, chapterPath, chapterTitle, matrixPath, beatsFallback, weekPrompt, history, iso }) {
  let draftSections = [];
  let matrixSections = [];
  try {
    if (chapterPath) {
      const f = join(vault, chapterPath);
      if (existsSync(f)) draftSections = sectionWordCounts(readFileSync(f, 'utf8'));
    }
  } catch { /* no draft yet */ }
  try {
    if (matrixPath) {
      const f = join(vault, matrixPath);
      if (existsSync(f)) matrixSections = parseMatrix(readFileSync(f, 'utf8'));
    }
  } catch { /* no matrix */ }

  const beats = buildBeats(matrixSections, draftSections, beatsFallback);
  const target = pickTarget(beats);
  let text = fallbackText(target, weekPrompt);
  let source = 'fallback';

  if (target) {
    let llmOk = false;
    try { llmOk = await isAvailable(); } catch { llmOk = false; }
    if (llmOk) {
      const recent = (history || []).slice(-5).map((h) => `${h.date}: ${h.words}w`).join(', ') || 'none logged yet';
      const breakdown = beats
        .map((b) => `- ${b.title}: ${b.words}w${b.gaps ? ` [${b.gaps} GAP]` : ''}${b.digests ? ` [${b.digests} to-digest]` : ''}`)
        .join('\n');
      const needs = (target.actions || []).slice(0, 3).map((a) => `- ${a}`).join('\n')
        || '- no specific evidence gaps logged; develop the argument and the prose';
      const system = `You are a sharp writing coach helping a nonfiction author make daily progress on one book chapter. Given what they have drafted and what the chapter still needs, write ONE punchy prompt (1-2 sentences, about 35 words max) telling them exactly what to work on TODAY. Be specific and a little provocative; aim at the thinnest or most-needed part. Address the author as "you". Output only the prompt — no preamble, no quotation marks, no markdown. Never use the "it's not X, it's Y" construction.`;
      const prompt = `Chapter: ${chapterTitle}\nToday: ${iso}\n\nSection word counts so far:\n${breakdown}\n\nFocus today on the section that needs the most work: “${target.title}” (${target.words} words).\nWhat that section still needs:\n${needs}\n\nRecent daily output: ${recent}\n\nWrite today's prompt.`;
      try {
        const out = await summarize({ system, prompt, options: { temperature: 0.5, num_predict: 200 }, label: `book-prompt ${iso}` });
        if (out) {
          text = out.replace(/\s+/g, ' ').replace(/^["“']|["”']$/g, '').trim();
          source = 'llm';
        }
      } catch { /* keep fallback */ }
    }
  }

  return { text, section: target ? target.title : null, source, generated_for: iso };
}

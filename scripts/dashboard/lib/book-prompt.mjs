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
 * Chapter-map source (in priority order): evidence matrix when one exists, then
 * a beats list from book-plan.json, then a beat sheet in 03_Chapters/Drafts
 * (a card with `kind: beat-sheet` + matching `chapter`), then the draft's own
 * ## headings. The matching chapter's beat sheet — and the whole-book synopsis
 * card (`kind: synopsis`, its per-chapter Job/Spine/Guardrail section + the book
 * spine) — are always fed to the LLM as the chapter's intended shape, even when
 * the matrix drives beat selection.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
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
    // Section headings come in two shapes: the old `## §N Title` and the
    // beat-mirrored `## Beat N — Title`.
    const h = line.match(/^##\s+((?:§\S+|Beat\s+\d+)\b.*\S)\s*$/i);
    if (h) {
      const title = h[1].replace(/^§\S+\s*/, '').replace(/^Beat\s+\d+\s*[—–-]\s*/i, '').trim();
      cur = { title, gaps: 0, digests: 0, actions: [] };
      out.push(cur);
      continue;
    }
    if (/^##\s/.test(line)) { cur = null; continue; }   // any other section ends the chapter map
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

function chapterTokenFromPath(p) {
  const base = (p || '').split('/').pop() || '';
  const m = base.match(/^(\d+)/);
  return m ? String(parseInt(m[1], 10)) : norm(base.replace(/\.draft\.md$/, '').replace(/\.md$/, ''));
}

function chapterMatches(sheetCh, token) {
  if (!sheetCh || !token) return false;
  const a = String(sheetCh).trim();
  if (/^\d+$/.test(a) && /^\d+$/.test(token)) return parseInt(a, 10) === parseInt(token, 10);
  const na = norm(a);
  const nt = norm(token);
  return na === nt || na.includes(nt) || nt.includes(na);
}

// Find the beat sheet for a chapter in 03_Chapters/Drafts: a markdown card with
// frontmatter `kind: beat-sheet` whose `chapter` matches. Returns the parsed
// beats + a condensed summary for the LLM, or null.
export function loadBeatSheet(vault, token) {
  let names;
  const dir = join(vault, '03_Chapters', 'Drafts');
  try { names = readdirSync(dir); } catch { return null; }
  for (const name of names) {
    if (!name.endsWith('.md')) continue;
    let text;
    try { text = readFileSync(join(dir, name), 'utf8'); } catch { continue; }
    const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm || !/^\s*kind\s*:\s*beat-sheet\s*$/m.test(fm[1])) continue;
    const chm = fm[1].match(/^\s*chapter\s*:\s*["']?([^"'\n]+?)["']?\s*$/m);
    const ch = chm ? chm[1].trim() : null;
    if (token && ch && !chapterMatches(ch, token)) continue;

    const beats = [];
    const spine = [];
    let curBeat = null;
    let inSpine = false;
    for (const line of text.split(/\r?\n/)) {
      const h2 = line.match(/^##\s+(.*\S)\s*$/);
      const h3 = line.match(/^###\s+(.*\S)\s*$/);
      if (h2) { inSpine = /spine/i.test(h2[1]); curBeat = null; continue; }
      if (h3) { curBeat = { title: h3[1].replace(/^Beat\s*\d+\s*[—–-]\s*/i, '').trim(), gist: '' }; beats.push(curBeat); continue; }
      const t = line.trim();
      if (!t) continue;
      if (inSpine && /^[-*]/.test(t)) spine.push(t.replace(/^[-*]\s*/, '').replace(/\*\*/g, ''));
      else if (curBeat && !curBeat.gist) curBeat.gist = t.replace(/`/g, '');
    }
    const condensed = [
      spine.length ? 'Spine: ' + spine.join(' | ') : '',
      ...beats.map((b, i) => `Beat ${i + 1}: ${b.title}${b.gist ? ` — ${b.gist}` : ''}`),
    ].filter(Boolean).join('\n').slice(0, 1800);
    return { file: name, chapter: ch, beats, condensed };
  }
  return null;
}

function synopsisHeadingMatches(heading, token) {
  const num = heading.match(/^Ch\.?\s*(\d+)\b/i);
  if (/^\d+$/.test(token)) return !!num && parseInt(num[1], 10) === parseInt(token, 10);
  return /introduction/i.test(heading) && /intro/.test(token);
}

// Load the whole-book synopsis card (kind: synopsis) from 03_Chapters/Drafts and
// pull the book spine + the current chapter's Job/Spine/Guardrail section.
export function loadSynopsis(vault, token) {
  const dir = join(vault, '03_Chapters', 'Drafts');
  let names;
  try { names = readdirSync(dir); } catch { return null; }
  for (const name of names) {
    if (!name.endsWith('.md')) continue;
    let text;
    try { text = readFileSync(join(dir, name), 'utf8'); } catch { continue; }
    const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm || !/^\s*kind\s*:\s*synopsis\s*$/m.test(fm[1])) continue;

    const spine = [];
    const chapter = [];
    let inSpine = false;
    let curIsTarget = false;
    for (const line of text.split(/\r?\n/)) {
      const h2 = line.match(/^##\s+(.*\S)\s*$/);
      const h3 = line.match(/^###\s+(.*\S)\s*$/);
      if (h2) { inSpine = /whole-book spine/i.test(h2[1]); curIsTarget = false; continue; }
      if (h3) { curIsTarget = synopsisHeadingMatches(h3[1], token); continue; }
      const t = line.trim();
      if (inSpine && /^[-*]/.test(t)) spine.push(t.replace(/^[-*]\s*/, '').replace(/\*\*/g, ''));
      else if (curIsTarget) chapter.push(line);
    }
    const unwiki = (s) => s.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1');
    const chapterText = unwiki(chapter.join('\n')).replace(/\n{3,}/g, '\n\n').trim().slice(0, 1600);
    if (!chapterText) return null; // synopsis exists but no section for this chapter
    return {
      file: name,
      spine: spine.length ? ('Whole-book spine: ' + spine.join(' | ')).slice(0, 900) : '',
      chapter: chapterText,
    };
  }
  return null;
}

// Merge the "needs" map with the draft's actual word counts.
function buildBeats(matrixSections, draftSections, beatsFallback, beatSheetBeats) {
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
  if (beatSheetBeats && beatSheetBeats.length) {
    return beatSheetBeats.map((b) => {
      const d = draftSections.find((ds) => titleMatch(ds.title, b.heading));
      return { title: b.heading, words: d ? d.words : 0, gaps: 0, digests: 0, actions: b.prompt ? [b.prompt] : [] };
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

  const token = chapterTokenFromPath(chapterPath);
  const beatSheet = loadBeatSheet(vault, token);
  const beatSheetBeats = beatSheet ? beatSheet.beats.map((b) => ({ heading: b.title, prompt: b.gist })) : null;
  const synopsis = loadSynopsis(vault, token);

  const beats = buildBeats(matrixSections, draftSections, beatsFallback, beatSheetBeats);
  const target = pickTarget(beats);
  let text = fallbackText(target, weekPrompt);
  let source = 'fallback';

  if (target) {
    let llmOk = false;
    try { llmOk = await isAvailable(); } catch { llmOk = false; }
    if (llmOk) {
      const recent = (history || []).slice(-5).map((h) => `${h.date}: ${h.words}w`).join(', ') || 'none logged yet';
      // What's actually on the page (the draft's own sections) is shown
      // separately from the beat/evidence map, since the two may not line up
      // 1:1 while the draft is mid-restructure.
      const drafted = (draftSections.length
        ? draftSections.map((s) => `- ${s.title}: ${s.words}w`)
        : ['- nothing drafted yet']).join('\n');
      const beatStatus = beats
        .map((b) => `- ${b.title}${b.gaps ? ` [${b.gaps} GAP]` : ''}${b.digests ? ` [${b.digests} to-digest]` : ''}`)
        .join('\n');
      const needs = (target.actions || []).slice(0, 3).map((a) => `- ${a}`).join('\n')
        || '- no specific evidence gaps logged; develop the argument and the prose';
      const sheetBlock = beatSheet ? `\n\nChapter beat sheet (the intended shape — use it to aim the prompt):\n${beatSheet.condensed}` : '';
      const synopsisBlock = synopsis
        ? `\n\nFrom the whole-book synopsis:\n${synopsis.spine}\n\nThis chapter's job, spine, and guardrail (synopsis):\n${synopsis.chapter}`
        : '';
      const system = `You are a sharp writing coach helping a nonfiction author make daily progress on one book chapter. Given what they have drafted, what the chapter still needs, the chapter's beat sheet, and the whole-book synopsis, write ONE punchy prompt (1-2 sentences, about 35 words max) telling them exactly what to work on TODAY. Be specific and a little provocative; aim at the thinnest or most-needed part, ground it in the beat sheet and synopsis, and respect the chapter's guardrail. Address the author as "you". Output only the prompt — no preamble, no quotation marks, no markdown. Never use the "it's not X, it's Y" construction.`;
      const prompt = `Chapter: ${chapterTitle}\nToday: ${iso}\n\nWhat you've drafted so far (the draft's own sections):\n${drafted}\n\nChapter beats and evidence status:\n${beatStatus}\n\nFocus today on the beat that needs the most work: “${target.title}”.\nWhat it still needs:\n${needs}${sheetBlock}${synopsisBlock}\n\nRecent daily output: ${recent}\n\nWrite today's prompt.`;
      try {
        const out = await summarize({ system, prompt, options: { temperature: 0.5, num_predict: 200, num_ctx: 8192 }, label: `book-prompt ${iso}` });
        if (out) {
          text = out.replace(/\s+/g, ' ').replace(/^["“']|["”']$/g, '').trim();
          source = 'llm';
        }
      } catch { /* keep fallback */ }
    }
  }

  return {
    text,
    section: target ? target.title : null,
    source,
    beat_sheet: beatSheet ? beatSheet.file : null,
    synopsis: synopsis ? synopsis.file : null,
    generated_for: iso,
  };
}

/**
 * cards.mjs — Phase 2
 *
 * Parses 06_Meta/Book/Cards/INDEX.md and reads each card file.
 * Returns structured data written into the snapshot under `snapshot.cards`.
 *
 * Output shape:
 * {
 *   total: number,
 *   sections: Array<{ label, type, entries: Array<{ slug, title, kind }> }>,
 *   content: { [slug]: { title, chapter, part, room, kind, created, updated, sources, body } }
 * }
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const VAULT = process.env.VAULT_PATH || join(homedir(), 'vaults/PostLiterate');
const CARDS_DIR = join(VAULT, '06_Meta/Book/Cards');
const INDEX_PATH = join(CARDS_DIR, 'INDEX.md');

// ── Frontmatter parser (no dependencies) ─────────────────────────────
//
// Handles the subset of YAML used in card files:
//   string scalars, quoted or bare
//   arrays of strings (indented dash items)
//
function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: text.trim() };

  const yaml = match[1];
  const body = match[2].trim();
  const fm = {};
  let currentKey = null;
  let isArray = false;

  for (const line of yaml.split(/\r?\n/)) {
    // Array item (indented dash)
    const arrayItem = line.match(/^\s+-\s+([\s\S]+)$/);
    if (arrayItem) {
      if (currentKey && isArray) {
        if (!Array.isArray(fm[currentKey])) fm[currentKey] = [];
        fm[currentKey].push(arrayItem[1].trim().replace(/^["']|["']$/g, ''));
      }
      continue;
    }
    // Key: value
    const kv = line.match(/^([\w][\w-]*)\s*:\s*(.*)$/);
    if (kv) {
      currentKey = kv[1];
      const val = kv[2].trim();
      if (val === '') {
        // Start of an array (or empty scalar — treat as array)
        fm[currentKey] = [];
        isArray = true;
      } else {
        isArray = false;
        fm[currentKey] = val.replace(/^["']|["']$/g, '');
      }
    }
  }

  return { frontmatter: fm, body };
}

// ── INDEX.md parser ───────────────────────────────────────────────────
//
// Produces a flat list of sections, each with an entries array.
// Section types: 'group' (front/back matter), 'part', 'chapter'
//
function parseIndex() {
  if (!existsSync(INDEX_PATH)) return [];

  const raw = readFileSync(INDEX_PATH, 'utf8');
  // Strip YAML frontmatter
  const body = raw.replace(/^---[\s\S]*?---\r?\n/, '');

  const sections = [];
  let currentSection = null;

  for (const line of body.split(/\r?\n/)) {
    // ## heading — Part or top-level group (front/back matter)
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      const label = h2[1].trim();
      currentSection = {
        label,
        type: label.toLowerCase().includes('part') ? 'part' : 'group',
        entries: [],
      };
      sections.push(currentSection);
      continue;
    }

    // ### heading — Chapter subsection
    const h3 = line.match(/^###\s+(.+)$/);
    if (h3) {
      currentSection = {
        label: h3[1].trim(),
        type: 'chapter',
        entries: [],
      };
      sections.push(currentSection);
      continue;
    }

    // List item — [[slug]] — Title *(kind)*
    const item = line.match(/^\s*-\s+\[\[([^\]]+)\]\](?:\s+—\s+(.+))?$/);
    if (item && currentSection) {
      const slug = item[1].trim();
      let titleRaw = item[2] ? item[2].trim() : slug;

      // Extract and strip *(title)* / *(part)* marker
      let kind = 'card';
      const kindMatch = titleRaw.match(/\s*\*(title|part)\*\s*$/);
      if (kindMatch) {
        kind = kindMatch[1];
        titleRaw = titleRaw.replace(/\s*\*(title|part)\*\s*$/, '').trim();
      }

      currentSection.entries.push({ slug, title: titleRaw, kind });
    }
  }

  return sections;
}

// ── Card file reader ──────────────────────────────────────────────────
function readCard(slug) {
  const filePath = join(CARDS_DIR, `${slug}.md`);
  if (!existsSync(filePath)) return null;

  try {
    const text = readFileSync(filePath, 'utf8');
    const { frontmatter: fm, body } = parseFrontmatter(text);
    return {
      title: fm.title || slug,
      chapter: fm.chapter || null,
      part: fm.part || null,
      room: fm.room || null,
      kind: fm.kind || null,
      created: fm.created || null,
      updated: fm.updated || null,
      sources: Array.isArray(fm.sources) ? fm.sources : [],
      body,
    };
  } catch {
    return null;
  }
}

// ── Main export ───────────────────────────────────────────────────────
export async function getCards() {
  const sections = parseIndex();

  // Walk sections once, deduplicating slugs
  const seen = new Set();
  const content = {};

  for (const section of sections) {
    for (const entry of section.entries) {
      if (seen.has(entry.slug)) continue;
      seen.add(entry.slug);
      const card = readCard(entry.slug);
      if (card) content[entry.slug] = card;
    }
  }

  return {
    total: seen.size,
    sections,
    content,
  };
}

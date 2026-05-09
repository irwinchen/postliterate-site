/**
 * todos.mjs — Phase 5
 *
 * Parses 06_Meta/TASKS.md into structured reminders for the dashboard.
 *
 * Supported syntax:
 *   ## Section heading            → group following items
 *   ### Subsection                → also a section
 *   - [ ] task description        → open task
 *   - [x] task description        → done task
 *   indented items                → child of preceding parent (one level)
 *   📅 YYYY-MM-DD                 → due date (Obsidian Tasks plugin convention)
 *   #tag                          → tag (collected into item.tags)
 *
 * Empty checkbox lines (no text after the bracket) are dropped.
 *
 * Items get a stable `line` identifier (1-indexed line number in the file)
 * so the toggle endpoint can rewrite that exact line without depending on
 * fragile text matches.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const VAULT = process.env.VAULT_PATH || join(homedir(), 'vaults/PostLiterate');
const TASKS_PATH = join(VAULT, '06_Meta/TASKS.md');

// ── Parsing ───────────────────────────────────────────────────
const DUE_DATE_RE = /📅\s*(\d{4}-\d{2}-\d{2})/;
const TAG_RE = /(?:^|\s)#([\w/-]+)/g;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function parseTaskLine(rawLine, lineNumber) {
  const m = rawLine.match(/^(\s*)-\s+\[([ xX])\]\s*(.*)$/);
  if (!m) return null;

  const indent = m[1].length;
  const done = m[2].toLowerCase() === 'x';
  let text = m[3];
  if (!text || !text.trim()) return null; // empty placeholder

  // Extract due date
  let due = null;
  const dueMatch = text.match(DUE_DATE_RE);
  if (dueMatch) {
    due = dueMatch[1];
    text = text.replace(DUE_DATE_RE, '').trim();
  }

  // Extract tags (collect, but keep them in the visible text — they're
  // typically meaningful to the reader)
  const tags = [];
  let tagMatch;
  TAG_RE.lastIndex = 0;
  while ((tagMatch = TAG_RE.exec(text)) !== null) tags.push(tagMatch[1]);

  return {
    line: lineNumber,
    indent,
    done,
    text: text.trim(),
    due,
    tags,
  };
}

function parseTasksFile(text) {
  const lines = text.split(/\r?\n/);
  const sections = [];
  let currentSection = { heading: null, level: 0, items: [] };
  sections.push(currentSection);

  let lastTopLevel = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;

    // Heading?
    const h = line.match(/^(#{2,3})\s+(.+?)\s*$/);
    if (h) {
      const level = h[1].length;
      currentSection = { heading: h[2].trim(), level, items: [] };
      sections.push(currentSection);
      lastTopLevel = null;
      continue;
    }

    const task = parseTaskLine(line, lineNumber);
    if (!task) continue;

    // One-level nesting: items with indent > 0 attach as children of the
    // most recent top-level item in the section.
    if (task.indent > 0 && lastTopLevel) {
      lastTopLevel.children = lastTopLevel.children || [];
      lastTopLevel.children.push(task);
    } else {
      currentSection.items.push(task);
      lastTopLevel = task;
    }
  }

  // Drop the implicit lead section if it's empty
  return sections.filter((s, idx) => idx === 0 ? s.items.length > 0 : true);
}

function rollupCounts(sections) {
  const today = todayIso();
  let total = 0;
  let open = 0;
  let done = 0;
  let overdue = 0;
  let due_today = 0;

  function visit(item) {
    total++;
    if (item.done) done++;
    else open++;
    if (item.due && !item.done) {
      if (item.due < today) overdue++;
      else if (item.due === today) due_today++;
    }
    if (item.children) item.children.forEach(visit);
  }

  for (const section of sections) {
    section.items.forEach(visit);
  }

  return { total, open, done, overdue, due_today };
}

// ── Main read export ──────────────────────────────────────────
export async function getTodos() {
  if (!existsSync(TASKS_PATH)) {
    return { total: 0, open: 0, done: 0, overdue: 0, due_today: 0, sections: [] };
  }
  const text = readFileSync(TASKS_PATH, 'utf8');
  const sections = parseTasksFile(text);
  const counts = rollupCounts(sections);
  return { ...counts, sections };
}

// ── Toggle export ─────────────────────────────────────────────
//
// Flips `[ ]` ↔ `[x]` on a specific line. The `line` arg is 1-indexed.
// We re-read the file on each call (no caching) and only mutate that
// specific line if it's still a checkbox task — protects against the
// file being edited concurrently in Obsidian.
//
export function toggleTodo(line, done) {
  if (typeof line !== 'number' || line < 1) {
    throw new Error('line must be a positive integer (1-indexed)');
  }
  if (!existsSync(TASKS_PATH)) {
    throw new Error('TASKS.md not found');
  }

  const text = readFileSync(TASKS_PATH, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);

  const idx = line - 1;
  if (idx >= lines.length) {
    throw new Error(`line ${line} out of range (file has ${lines.length} lines)`);
  }

  const target = lines[idx];
  const m = target.match(/^(\s*-\s+\[)([ xX])(\]\s*.*)$/);
  if (!m) {
    throw new Error(`line ${line} is not a checkbox task: ${target.slice(0, 80)}`);
  }

  const newCheck = done ? 'x' : ' ';
  if (m[2].toLowerCase() === newCheck) {
    return { changed: false, line, done };
  }

  lines[idx] = `${m[1]}${newCheck}${m[3]}`;
  writeFileSync(TASKS_PATH, lines.join(eol), 'utf8');
  return { changed: true, line, done };
}

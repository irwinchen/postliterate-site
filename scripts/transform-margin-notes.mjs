#!/usr/bin/env node
/**
 * Transforms Obsidian-style highlighted footnotes into MarginNote components.
 *
 * Obsidian syntax:
 *   ==anchor text==[^1] and more ==anchor text==[^2].
 *   [^1]: Margin note content with [links](url).
 *   [^2]: Another note.
 *
 * Becomes:
 *   import MarginNote from '../../components/MarginNote.astro';
 *   <MarginNote id="1" note="Margin note content with <a href='url'>links</a>.">anchor text</MarginNote> and more ...
 */

import { readFileSync, writeFileSync } from 'fs';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node transform-margin-notes.mjs <file.mdx>');
  process.exit(1);
}

let content = readFileSync(file, 'utf-8');

// Collect footnote definitions: [^id]: content (may span multiple indented lines)
const footnotes = new Map();
const defPattern = /^\[\^(\w+)\]:\s*(.+)$/gm;
let match;

while ((match = defPattern.exec(content)) !== null) {
  const id = match[1];
  let body = match[2];

  // Check for continuation lines (indented by 2+ spaces on next lines)
  const afterDef = content.slice(match.index + match[0].length);
  const contMatch = afterDef.match(/^(\n {2,}.+)+/);
  if (contMatch) {
    body += contMatch[0].replace(/\n {2,}/g, ' ');
  }

  footnotes.set(id, body.trim());
}

// If no footnotes reference highlights, leave file untouched
const highlightFootnotePattern = /==([^=]+?)==\[\^(\w+)\]/;
if (!highlightFootnotePattern.test(content)) {
  process.exit(0);
}

// Convert markdown links in note text to HTML <a> tags
function mdLinksToHtml(text) {
  return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<a href='$2'>$1</a>");
}

// Escape double quotes for the note attribute
function escapeAttr(text) {
  return text.replace(/"/g, '&quot;');
}

// Replace ==anchor text==[^id] with <MarginNote> components
const usedFootnotes = new Set();
content = content.replace(/==([^=]+?)==\[\^(\w+)\]/g, (_, anchor, id) => {
  const noteContent = footnotes.get(id);
  if (!noteContent) {
    console.warn(`Warning: No footnote definition found for [^${id}]`);
    return `${anchor}[^${id}]`;
  }
  usedFootnotes.add(id);
  const noteHtml = escapeAttr(mdLinksToHtml(noteContent));
  return `<MarginNote id="${id}" note="${noteHtml}">${anchor}</MarginNote>`;
});

// Remove used footnote definitions (and their continuation lines)
for (const id of usedFootnotes) {
  const defLinePattern = new RegExp(
    `^\\[\\^${id}\\]:\\s*.+(\\n {2,}.+)*\\n?`,
    'gm'
  );
  content = content.replace(defLinePattern, '');
}

// Clean up blank lines left by removed definitions
content = content.replace(/\n{3,}/g, '\n\n');

// Add import after frontmatter closing ---
const fmClose = content.indexOf('---', content.indexOf('---') + 3);
if (fmClose !== -1) {
  const insertPos = fmClose + 3;
  const after = content.slice(insertPos);
  // Only add import if not already present
  if (!content.includes("import MarginNote")) {
    content = content.slice(0, insertPos) + "\nimport MarginNote from '../../components/MarginNote.astro';" + after;
  }
}

writeFileSync(file, content, 'utf-8');
const count = usedFootnotes.size;
console.log(`Transformed ${count} margin note${count !== 1 ? 's' : ''}.`);

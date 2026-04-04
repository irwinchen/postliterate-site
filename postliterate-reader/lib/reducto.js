/**
 * Reducto.ai API client and HTML converter for PDF support.
 *
 * Two concerns:
 * 1. API calls (uploadToReducto, parseWithReducto) — network I/O
 * 2. Conversion (convertReductoToHtml, extractPdfMetadata) — pure functions
 */

const REDUCTO_BASE = 'https://platform.reducto.ai';

// Block types that are page artifacts — skip these
const SKIP_TYPES = new Set(['Header', 'Footer', 'Page Number']);

// Block types containing raw HTML (don't escape)
const RAW_HTML_TYPES = new Set(['Table']);

/**
 * Check if a string looks like a filename rather than a proper title.
 * Filenames tend to have underscores, no spaces, and file extensions.
 */
function looksLikeFilename(str) {
  if (!str) return false;
  const trimmed = str.trim();
  // Has underscores and no spaces → likely a filename
  if (trimmed.includes('_') && !trimmed.includes(' ')) return true;
  // Ends with a file extension
  if (/\.\w{2,4}$/.test(trimmed)) return true;
  return false;
}

/**
 * Pick the best title from all Title blocks.
 * Prefers the longest non-filename title.
 */
function pickBestTitle(allBlocks) {
  const titleBlocks = allBlocks
    .filter((b) => b.type === 'Title' && b.content?.trim());

  if (titleBlocks.length === 0) return null;

  // Prefer non-filename titles
  const properTitles = titleBlocks.filter((b) => !looksLikeFilename(b.content));
  const candidates = properTitles.length > 0 ? properTitles : titleBlocks;

  // Pick the longest — it's most likely the real document title
  let best = candidates[0];
  for (const b of candidates) {
    if (b.content.length > best.content.length) best = b;
  }
  return best.content.trim();
}

/**
 * Escape HTML entities in text content.
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Convert basic markdown inline formatting to HTML.
 * Handles **bold** and *italic*.
 */
function convertInlineMarkdown(escaped) {
  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');
}

/**
 * Detect if text looks like a markdown pipe table (3+ lines with pipes).
 */
function isMarkdownTable(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return false;
  // At least the header row and separator row must have pipes
  return lines[0].includes('|') && lines.length >= 2 && /^\|?[\s-]+\|/.test(lines[1]);
}

/**
 * Convert a markdown pipe table string to an HTML <table>.
 */
function markdownTableToHtml(text) {
  const lines = text.trim().split('\n').map((l) => l.trim());
  const parseRow = (line) =>
    line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

  const headerCells = parseRow(lines[0]);
  // lines[1] is the separator row (|---|---|), skip it
  const bodyRows = lines.slice(2).filter((l) => l.includes('|'));

  let html = '<table><thead><tr>';
  for (const cell of headerCells) {
    html += `<th>${escapeHtml(cell)}</th>`;
  }
  html += '</tr></thead><tbody>';
  for (const row of bodyRows) {
    html += '<tr>';
    for (const cell of parseRow(row)) {
      html += `<td>${escapeHtml(cell)}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  return html;
}

/**
 * Upload a file to Reducto and get a file_id for parsing.
 *
 * @param {string} apiKey - Reducto API key
 * @param {ArrayBuffer} arrayBuffer - PDF file bytes
 * @param {string} filename - Original filename
 * @returns {Promise<string>} file_id
 */
export async function uploadToReducto(apiKey, arrayBuffer, filename) {
  const formData = new FormData();
  formData.append('file', new Blob([arrayBuffer], { type: 'application/pdf' }), filename);

  const resp = await fetch(`${REDUCTO_BASE}/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Reducto upload failed (${resp.status}): ${text}`);
  }

  const data = await resp.json();
  return data.file_id;
}

/**
 * Parse a document with Reducto.
 *
 * @param {string} apiKey - Reducto API key
 * @param {string} input - file_id (from upload) or a public URL
 * @returns {Promise<object>} Reducto parse result
 */
export async function parseWithReducto(apiKey, input) {
  const resp = await fetch(`${REDUCTO_BASE}/parse`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Reducto parse failed (${resp.status}): ${text}`);
  }

  return resp.json();
}

/**
 * Convert Reducto parse result to semantic HTML for the reading overlay.
 *
 * Maps Reducto block types to HTML elements that parseBlocks() in
 * content/block-parser.js recognizes: P, H1-H6, FIGURE, BLOCKQUOTE,
 * UL, OL, PRE, TABLE, HR, ASIDE, DL, DETAILS.
 *
 * @param {object} result - Reducto parse response
 * @returns {{ html: string, title: string|null }}
 */
export function convertReductoToHtml(result) {
  const allBlocks = [];
  for (const chunk of result.result.chunks) {
    allBlocks.push(...chunk.blocks);
  }

  const title = pickBestTitle(allBlocks);
  const parts = [];
  let pendingListItems = [];

  function flushList() {
    if (pendingListItems.length > 0) {
      parts.push('<ul>' + pendingListItems.map((li) => `<li>${convertInlineMarkdown(escapeHtml(li))}</li>`).join('') + '</ul>');
      pendingListItems = [];
    }
  }

  for (const b of allBlocks) {
    // Skip page artifacts
    if (SKIP_TYPES.has(b.type)) continue;

    // Skip empty content
    if (!b.content || !b.content.trim()) continue;

    const content = b.content;

    if (b.type === 'List Item') {
      pendingListItems.push(content);
      continue;
    }

    // Flush any pending list before emitting a non-list block
    flushList();

    switch (b.type) {
      case 'Title':
        parts.push(`<h1>${escapeHtml(content)}</h1>`);
        break;

      case 'Section Header':
        parts.push(`<h2>${escapeHtml(content)}</h2>`);
        break;

      case 'Text':
        if (isMarkdownTable(content)) {
          parts.push(markdownTableToHtml(content));
        } else {
          parts.push(`<p>${convertInlineMarkdown(escapeHtml(content))}</p>`);
        }
        break;

      case 'Table':
        // Table content may be HTML or markdown — detect and convert
        if (content.trim().startsWith('<')) {
          parts.push(content);
        } else if (isMarkdownTable(content)) {
          parts.push(markdownTableToHtml(content));
        } else {
          parts.push(`<p>${escapeHtml(content)}</p>`);
        }
        break;

      case 'Figure':
        if (b.image_url) {
          parts.push(
            `<figure><img src="${escapeHtml(b.image_url)}" alt="${escapeHtml(content)}">` +
            `<figcaption>${escapeHtml(content)}</figcaption></figure>`
          );
        } else {
          parts.push(`<figure><figcaption>${escapeHtml(content)}</figcaption></figure>`);
        }
        break;

      case 'Comment':
        parts.push(`<blockquote><p>${escapeHtml(content)}</p></blockquote>`);
        break;

      case 'Key Value':
        parts.push(`<p>${escapeHtml(content)}</p>`);
        break;

      default:
        // Unknown type — render as paragraph
        parts.push(`<p>${escapeHtml(content)}</p>`);
        break;
    }
  }

  // Flush any trailing list items
  flushList();

  return { html: parts.join('\n'), title };
}

/**
 * Extract metadata from a Reducto parse result.
 *
 * @param {object} result - Reducto parse response
 * @returns {{ title: string|null, pageCount: number, wordCount: number }}
 */
export function extractPdfMetadata(result) {
  const allBlocks = [];
  for (const chunk of result.result.chunks) {
    allBlocks.push(...chunk.blocks);
  }

  const title = pickBestTitle(allBlocks);
  let wordCount = 0;

  for (const b of allBlocks) {
    if (SKIP_TYPES.has(b.type)) continue;
    if (!b.content || !b.content.trim()) continue;

    // Count words in content blocks
    wordCount += b.content.trim().split(/\s+/).length;
  }

  return {
    title,
    pageCount: result.usage?.num_pages || 0,
    wordCount,
  };
}

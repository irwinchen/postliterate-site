/**
 * Block-level element tag names that should remain as standalone blocks.
 */
const BLOCK_TAGS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'FIGURE', 'BLOCKQUOTE', 'UL', 'OL', 'PRE',
  'TABLE', 'HR', 'ASIDE', 'DL', 'DETAILS',
]);

/**
 * Tags that indicate an element contains block-level children
 * and should be flattened (its children promoted to top-level blocks).
 */
const WRAPPER_TAGS = new Set(['DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'NAV']);

/**
 * Check if an element has any block-level children.
 */
function hasBlockChildren(el) {
  for (const child of el.children) {
    if (BLOCK_TAGS.has(child.tagName) || WRAPPER_TAGS.has(child.tagName)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if an element is empty or whitespace-only.
 */
function isEmpty(el) {
  if (el.tagName === 'HR') return false;
  if (el.querySelector('img, video, iframe, svg, canvas')) return false;
  return !el.textContent.trim();
}

/**
 * Patterns that indicate a block is a Readability artifact or site chrome
 * that leaked through extraction. Matched against trimmed text content.
 */
const ARTIFACT_PATTERNS = [
  /^From Wikipedia, the free encyclopedia$/i,
  /^\(Redirected from .+\)$/i,
  /^\[edit\]$/i,
  /^Advertisement$/i,
  /^Share this article$/i,
  /^Related articles?$/i,
  /^More from /i,
  /^Sign up for /i,
  /^Subscribe to /i,
  /^Newsletter$/i,
  /^Image$/i,
  /^Credit\.{0,3}$/i,
  /^Photo$/i,
  /^Photograph:/i,
  /^Skip\s*Advertisement$/i,
  /^Guest Essay$/i,
  /^Supported by$/i,
];

/**
 * Check if a block is a known extraction artifact that should be removed.
 */
function isArtifact(el) {
  const text = el.textContent.trim();
  if (!text) return false;
  return ARTIFACT_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Clean up elements before block collection:
 * - Remove Wikipedia [edit] spans within headings
 * - Remove empty citation/reference links
 */
function cleanupElement(el) {
  // Remove [edit] spans/links (Wikipedia)
  for (const editLink of el.querySelectorAll('.mw-editsection, [title="Edit section"]')) {
    editLink.remove();
  }
  // Remove empty sup references that are just bracket numbers like [1][2]
  // Keep them — they're part of the content. Just strip the [edit] chrome.
}

/**
 * Parse an HTML string from Readability into an array of block-level DOM elements
 * suitable for one-at-a-time reveal in the reading UI.
 *
 * - Splits into block-level elements (p, h1-h6, figure, blockquote, ul, ol, pre, table, hr)
 * - Flattens wrapper divs that contain block children
 * - Wraps orphaned inline elements into <p> tags
 * - Filters out empty/whitespace-only elements
 *
 * @param {string} html - HTML string (typically from Readability's article.content)
 * @returns {Element[]} Array of block-level DOM elements in reading order
 */
export function parseBlocks(html) {
  if (!html) return [];

  const container = document.createElement('div');
  container.innerHTML = html;

  // Clean up known site chrome before parsing
  cleanupElement(container);

  const blocks = [];
  collectBlocks(container, blocks);

  return blocks.filter((el) => !isEmpty(el) && !isArtifact(el));
}

/**
 * Recursively collect block-level elements from a container.
 * Flattens wrapper divs, wraps orphan inline runs.
 */
function collectBlocks(container, blocks) {
  let inlineRun = [];

  function flushInlines() {
    if (inlineRun.length === 0) return;
    const p = document.createElement('p');
    for (const node of inlineRun) {
      p.appendChild(node.cloneNode(true));
    }
    if (p.textContent.trim()) {
      blocks.push(p);
    }
    inlineRun = [];
  }

  for (const node of Array.from(container.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent.trim()) {
        inlineRun.push(node);
      }
      continue;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) continue;

    const tag = node.tagName;

    if (BLOCK_TAGS.has(tag)) {
      flushInlines();
      blocks.push(node);
    } else if (WRAPPER_TAGS.has(tag) && hasBlockChildren(node)) {
      // Flatten: recurse into the wrapper's children
      flushInlines();
      collectBlocks(node, blocks);
    } else if (WRAPPER_TAGS.has(tag) && !hasBlockChildren(node)) {
      // Div with only inline content — treat as a block
      flushInlines();
      blocks.push(node);
    } else {
      // Inline element — accumulate
      inlineRun.push(node);
    }
  }

  flushInlines();
}

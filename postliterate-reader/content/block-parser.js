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
  /^Photo$/i,
  /^Photograph:/i,
  /^Skip\s*Advertisement$/i,
  /^Guest Essay$/i,
  /^Supported by$/i,
  // Promotional / navigational headings
  /^You might also like/i,
  /^You may also like/i,
  /^Recommended$/i,
  /^Trending$/i,
  /^What to read next$/i,
  /^Popular$/i,
  /^Don.t miss/i,
  /^Editor.s picks?$/i,
  /^Latest stories$/i,
  /^Read more$/i,
  /^More stories/i,
  /^Follow .+ on/i,
  // NYTimes-specific credits
  /^Credit\b/i,
  /^By .+ for The (?:New York )?Times$/i,
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
 * Check if a list (UL/OL) is a navigational/promotional link list.
 * A list is link-heavy if most of its items are predominantly links
 * with little surrounding text.
 */
function isLinkList(el) {
  if (el.tagName !== 'UL' && el.tagName !== 'OL') return false;
  const items = el.querySelectorAll(':scope > li');
  if (items.length === 0) return false;

  let linkOnlyCount = 0;
  for (const li of items) {
    const linkText = Array.from(li.querySelectorAll('a'))
      .reduce((sum, a) => sum + a.textContent.trim().length, 0);
    const totalText = li.textContent.trim().length;
    // If link text is >80% of the item's text, it's a link-only item
    if (totalText > 0 && linkText / totalText > 0.8) {
      linkOnlyCount++;
    }
  }

  // If >60% of items are link-only, it's a nav/promo list
  return linkOnlyCount / items.length > 0.6;
}

/**
 * Check if a figure contains only tracking pixels or empty/placeholder images.
 */
function isJunkFigure(el) {
  if (el.tagName !== 'FIGURE') return false;
  const imgs = el.querySelectorAll('img');
  if (imgs.length === 0) return false;

  for (const img of imgs) {
    const src = img.getAttribute('src') || '';
    const width = parseInt(img.getAttribute('width'), 10);
    const height = parseInt(img.getAttribute('height'), 10);

    const isTrackingPixel = !isNaN(width) && !isNaN(height) && width <= 1 && height <= 1;
    const isBase64Placeholder = src.startsWith('data:image/') && src.length < 200;

    // If ANY image is real, keep the figure
    if (!isTrackingPixel && !isBase64Placeholder) return false;
  }
  // All images are junk
  return true;
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

  return blocks.filter((el) => !isEmpty(el) && !isArtifact(el) && !isLinkList(el) && !isJunkFigure(el));
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

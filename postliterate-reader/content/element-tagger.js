/**
 * Element tagger — pre-tags original DOM elements before Readability extraction,
 * then maps Readability's output back to original elements.
 *
 * Readability is used as a *selector* (which elements are the article?)
 * not a content source. All content flows from original page elements
 * through one cleanup pipeline.
 */

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG']);
const SAFE_ATTRS = new Set(['href', 'src', 'alt', 'width', 'height', 'colspan', 'rowspan']);

/**
 * Stamp every element under `root` with a sequential `data-pl-id`.
 * Skips script/style elements. Returns the total count of tagged elements.
 */
export function tagElements(root) {
  let id = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (SKIP_TAGS.has(node.tagName)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  while (walker.nextNode()) {
    walker.currentNode.setAttribute('data-pl-id', String(id++));
  }
  return id;
}

/**
 * Parse an HTML string (Readability output) and collect all surviving
 * `data-pl-id` values into a Set.
 */
export function collectSurvivingIds(html) {
  const container = document.createElement('div');
  container.innerHTML = html;
  const ids = new Set();
  for (const el of container.querySelectorAll('[data-pl-id]')) {
    ids.add(el.getAttribute('data-pl-id'));
  }
  return ids;
}

/**
 * Normalize text for fingerprint matching: collapse whitespace, trim.
 */
function normalizeText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Find an original element whose normalized text content matches the given text.
 * Optionally skips elements already in `alreadyFound` set (for duplicate text).
 * Returns the matched element or null.
 */
export function matchByTextFingerprint(text, root, alreadyFound = new Set()) {
  const needle = normalizeText(text);
  if (!needle) return null;

  const all = root.querySelectorAll('[data-pl-id]');
  for (const el of all) {
    if (alreadyFound.has(el)) continue;
    if (normalizeText(el.textContent) === needle) return el;
  }
  return null;
}

/**
 * Clean up a cloned element for the reading overlay:
 * - Remove classes, data attributes, inline event handlers
 * - Remove script/style children
 * - Preserve safe attributes (href, src, alt, etc.)
 * - Optionally wrap in a different tag (e.g., img → figure)
 */
export function cleanupElement(el, wrapTag) {
  const clone = el.cloneNode(true);

  // If wrapping (e.g., img → figure), create wrapper and move clone inside
  let result;
  if (wrapTag && clone.tagName !== wrapTag) {
    result = document.createElement(wrapTag);
    result.appendChild(clone);
  } else {
    result = clone;
  }

  // Recursively clean attributes on all elements
  const allEls = [result, ...result.querySelectorAll('*')];
  for (const node of allEls) {
    // Remove script/style elements
    if (SKIP_TAGS.has(node.tagName)) {
      node.remove();
      continue;
    }

    // Clean attributes
    const attrs = Array.from(node.attributes);
    for (const attr of attrs) {
      if (SAFE_ATTRS.has(attr.name)) continue;
      node.removeAttribute(attr.name);
    }
  }

  return result;
}

/**
 * Assemble a set of selected original elements into reading-order blocks.
 * Clones each element, runs cleanup, and sorts by DOM order.
 */
export function assembleBlocks(selectedSet) {
  if (selectedSet.size === 0) return [];

  // Sort by DOM order
  const sorted = Array.from(selectedSet).sort((a, b) => {
    const pos = a.compareDocumentPosition(b);
    return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });

  return sorted.map((el) => cleanupElement(el));
}

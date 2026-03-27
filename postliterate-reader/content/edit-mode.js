/**
 * Edit Mode — manages the selection state for refining Readability's extraction.
 *
 * Holds a set of selected original DOM elements, supports add/remove/reclassify,
 * and assembles the final block list through a single cleanup pipeline.
 */

import { cleanupElement } from './element-tagger.js';

/**
 * Tag inference: map DOM tag names to semantic block types.
 * Returns the inferred tag for use in the reading overlay.
 */
const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
const BLOCK_TAGS = new Set(['P', 'BLOCKQUOTE', 'PRE', 'UL', 'OL', 'TABLE', 'HR', 'DL', 'DETAILS', 'ASIDE', 'FIGURE']);

function inferTagFromDOM(el) {
  const tag = el.tagName;
  if (HEADING_TAGS.has(tag)) return tag;
  if (BLOCK_TAGS.has(tag)) return tag;
  if (tag === 'IMG') return 'FIGURE';
  // Ambiguous containers default to P
  return 'P';
}

export class EditMode {
  /**
   * @param {Element} page - The root of the original page (usually document.body)
   * @param {Set<string>} selectedIds - Set of data-pl-id values from Readability
   */
  constructor(page, selectedIds) {
    this._page = page;
    this._originalIds = new Set(selectedIds);
    this._tagOverrides = new Map();

    // Resolve IDs to DOM elements
    this.selectedElements = new Set();
    for (const id of selectedIds) {
      const el = page.querySelector(`[data-pl-id="${id}"]`);
      if (el) this.selectedElements.add(el);
    }
  }

  isSelected(el) {
    return this.selectedElements.has(el);
  }

  remove(el) {
    this.selectedElements.delete(el);
  }

  add(el) {
    this.selectedElements.add(el);
  }

  inferTag(el) {
    return inferTagFromDOM(el);
  }

  getTag(el) {
    return this._tagOverrides.get(el) || inferTagFromDOM(el);
  }

  reclassify(el, tag) {
    this._tagOverrides.set(el, tag);
  }

  reset() {
    this.selectedElements.clear();
    this._tagOverrides.clear();
    for (const id of this._originalIds) {
      const el = this._page.querySelector(`[data-pl-id="${id}"]`);
      if (el) this.selectedElements.add(el);
    }
  }

  getBlockCount() {
    return this.selectedElements.size;
  }

  /**
   * Assemble the final block list: clone selected elements in DOM order,
   * apply cleanup, respect tag overrides.
   */
  assemble() {
    if (this.selectedElements.size === 0) return [];

    const sorted = Array.from(this.selectedElements).sort((a, b) => {
      const pos = a.compareDocumentPosition(b);
      return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });

    return sorted.map((el) => {
      const tag = this.getTag(el);
      const needsWrap = (el.tagName === 'IMG' && tag === 'FIGURE');
      const needsReclassify = (tag !== el.tagName && !needsWrap);

      if (needsWrap) {
        return cleanupElement(el, 'FIGURE');
      }

      if (needsReclassify) {
        // Create new element with the target tag, move cleaned children
        const cleaned = cleanupElement(el);
        const wrapper = document.createElement(tag);
        while (cleaned.firstChild) {
          wrapper.appendChild(cleaned.firstChild);
        }
        return wrapper;
      }

      return cleanupElement(el);
    });
  }
}

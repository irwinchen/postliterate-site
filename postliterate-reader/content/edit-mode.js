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
    this._removedIds = new Set();

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

    // Track the removed element's ID so it gets stripped from clones during assembly.
    // This handles both directly selected elements and elements nested inside
    // a selected ancestor — assemble() strips removed IDs from clones.
    const id = el.getAttribute('data-pl-id');
    if (id) this._removedIds.add(id);
  }

  add(el) {
    this.selectedElements.add(el);
    const id = el.getAttribute('data-pl-id');
    if (id) this._removedIds.delete(id);
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
    this._removedIds.clear();
    for (const id of this._originalIds) {
      const el = this._page.querySelector(`[data-pl-id="${id}"]`);
      if (el) this.selectedElements.add(el);
    }
  }

  getBlockCount() {
    return this.selectedElements.size;
  }

  /**
   * Return the current selection as a set of data-pl-id values.
   */
  getSelectedIds() {
    const ids = new Set();
    for (const el of this.selectedElements) {
      const id = el.getAttribute('data-pl-id');
      if (id) ids.add(id);
    }
    return ids;
  }

  /**
   * Assemble the final block list: clone selected elements in DOM order,
   * apply cleanup, respect tag overrides.
   * Filters out elements whose ancestor is also selected (avoids duplicates).
   */
  assemble() {
    if (this.selectedElements.size === 0) return [];

    // Filter: skip any element that has an ancestor also in the selected set
    const leafElements = Array.from(this.selectedElements).filter((el) => {
      let parent = el.parentElement;
      while (parent) {
        if (this.selectedElements.has(parent)) return false;
        parent = parent.parentElement;
      }
      return true;
    });

    const sorted = leafElements.sort((a, b) => {
      const pos = a.compareDocumentPosition(b);
      return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });

    return sorted.map((el) => {
      // Clone first so we can strip removed descendants before cleanup
      // (cleanup strips data-pl-id, so we must remove zombies first)
      const clone = el.cloneNode(true);
      if (this._removedIds.size > 0) {
        for (const removedId of this._removedIds) {
          const zombie = clone.querySelector(`[data-pl-id="${removedId}"]`);
          if (zombie) zombie.remove();
        }
      }

      const tag = this.getTag(el);
      const needsWrap = (el.tagName === 'IMG' && tag === 'FIGURE');
      const needsReclassify = (tag !== el.tagName && !needsWrap);

      if (needsWrap) {
        return cleanupElement(clone, 'FIGURE');
      }

      if (needsReclassify) {
        const cleaned = cleanupElement(clone);
        const wrapper = document.createElement(tag);
        while (cleaned.firstChild) {
          wrapper.appendChild(cleaned.firstChild);
        }
        return wrapper;
      }

      return cleanupElement(clone);
    });
  }
}

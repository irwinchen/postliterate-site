import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EditMode } from '../content/edit-mode.js';
import { parseBlocks } from '../content/block-parser.js';

describe('EditMode', () => {
  let page;
  let selectedIds;

  beforeEach(() => {
    document.body.innerHTML = `
      <article>
        <h1 data-pl-id="0">Article Title</h1>
        <p data-pl-id="1">First paragraph.</p>
        <p data-pl-id="2">Second paragraph.</p>
        <div data-pl-id="3" class="ad-banner">Buy stuff!</div>
        <p data-pl-id="4">Third paragraph.</p>
        <img data-pl-id="5" src="photo.jpg" alt="A photo">
        <h2 data-pl-id="6">Subheading</h2>
        <blockquote data-pl-id="7"><p>A quote</p></blockquote>
      </article>
    `;
    page = document.body;
    // Simulate Readability selected these IDs
    selectedIds = new Set(['0', '1', '2', '4', '6', '7']);
  });

  describe('initialization', () => {
    it('creates an EditMode with a selection set from IDs', () => {
      const mode = new EditMode(page, selectedIds);
      expect(mode.selectedElements.size).toBe(6);
    });

    it('resolves IDs to actual DOM elements', () => {
      const mode = new EditMode(page, selectedIds);
      for (const el of mode.selectedElements) {
        expect(el.nodeType).toBe(Node.ELEMENT_NODE);
        expect(selectedIds.has(el.getAttribute('data-pl-id'))).toBe(true);
      }
    });

    it('ignores IDs that do not exist in the page', () => {
      selectedIds.add('999');
      const mode = new EditMode(page, selectedIds);
      expect(mode.selectedElements.size).toBe(6);
    });
  });

  describe('isSelected', () => {
    it('returns true for selected elements', () => {
      const mode = new EditMode(page, selectedIds);
      const p1 = page.querySelector('[data-pl-id="1"]');
      expect(mode.isSelected(p1)).toBe(true);
    });

    it('returns false for unselected elements', () => {
      const mode = new EditMode(page, selectedIds);
      const ad = page.querySelector('[data-pl-id="3"]');
      expect(mode.isSelected(ad)).toBe(false);
    });
  });

  describe('remove', () => {
    it('removes an element from the selection', () => {
      const mode = new EditMode(page, selectedIds);
      const p2 = page.querySelector('[data-pl-id="2"]');
      mode.remove(p2);
      expect(mode.isSelected(p2)).toBe(false);
      expect(mode.selectedElements.size).toBe(5);
    });

    it('does nothing if element is not selected', () => {
      const mode = new EditMode(page, selectedIds);
      const ad = page.querySelector('[data-pl-id="3"]');
      mode.remove(ad);
      expect(mode.selectedElements.size).toBe(6);
    });
  });

  describe('add', () => {
    it('adds an element to the selection', () => {
      const mode = new EditMode(page, selectedIds);
      const ad = page.querySelector('[data-pl-id="3"]');
      mode.add(ad);
      expect(mode.isSelected(ad)).toBe(true);
      expect(mode.selectedElements.size).toBe(7);
    });

    it('does nothing if element is already selected', () => {
      const mode = new EditMode(page, selectedIds);
      const p1 = page.querySelector('[data-pl-id="1"]');
      mode.add(p1);
      expect(mode.selectedElements.size).toBe(6);
    });
  });

  describe('inferTag', () => {
    it('infers P for paragraph elements', () => {
      const mode = new EditMode(page, selectedIds);
      const p = page.querySelector('[data-pl-id="1"]');
      expect(mode.inferTag(p)).toBe('P');
    });

    it('infers H1-H6 for heading elements', () => {
      const mode = new EditMode(page, selectedIds);
      const h1 = page.querySelector('[data-pl-id="0"]');
      const h2 = page.querySelector('[data-pl-id="6"]');
      expect(mode.inferTag(h1)).toBe('H1');
      expect(mode.inferTag(h2)).toBe('H2');
    });

    it('infers FIGURE for img elements', () => {
      const mode = new EditMode(page, selectedIds);
      const img = page.querySelector('[data-pl-id="5"]');
      expect(mode.inferTag(img)).toBe('FIGURE');
    });

    it('infers BLOCKQUOTE for blockquote elements', () => {
      const mode = new EditMode(page, selectedIds);
      const bq = page.querySelector('[data-pl-id="7"]');
      expect(mode.inferTag(bq)).toBe('BLOCKQUOTE');
    });

    it('defaults to P for div elements', () => {
      const mode = new EditMode(page, selectedIds);
      const div = page.querySelector('[data-pl-id="3"]');
      expect(mode.inferTag(div)).toBe('P');
    });
  });

  describe('reclassify', () => {
    it('changes the tag override for an element', () => {
      const mode = new EditMode(page, selectedIds);
      const p = page.querySelector('[data-pl-id="1"]');
      mode.reclassify(p, 'BLOCKQUOTE');
      expect(mode.getTag(p)).toBe('BLOCKQUOTE');
    });

    it('inferTag still returns original tag if no override', () => {
      const mode = new EditMode(page, selectedIds);
      const p = page.querySelector('[data-pl-id="1"]');
      expect(mode.getTag(p)).toBe('P');
    });
  });

  describe('reset', () => {
    it('restores the original Readability selection', () => {
      const mode = new EditMode(page, selectedIds);
      const ad = page.querySelector('[data-pl-id="3"]');
      const p1 = page.querySelector('[data-pl-id="1"]');
      mode.add(ad);
      mode.remove(p1);
      expect(mode.selectedElements.size).toBe(6); // removed 1, added 1
      expect(mode.isSelected(ad)).toBe(true);

      mode.reset();
      expect(mode.selectedElements.size).toBe(6);
      expect(mode.isSelected(ad)).toBe(false);
      expect(mode.isSelected(p1)).toBe(true);
    });

    it('clears all tag overrides on reset', () => {
      const mode = new EditMode(page, selectedIds);
      const p = page.querySelector('[data-pl-id="1"]');
      mode.reclassify(p, 'BLOCKQUOTE');
      mode.reset();
      expect(mode.getTag(p)).toBe('P');
    });
  });

  describe('getBlockCount', () => {
    it('returns the number of selected elements', () => {
      const mode = new EditMode(page, selectedIds);
      expect(mode.getBlockCount()).toBe(6);
      mode.remove(page.querySelector('[data-pl-id="1"]'));
      expect(mode.getBlockCount()).toBe(5);
    });
  });

  describe('assemble', () => {
    it('returns cleaned blocks in DOM order', () => {
      const mode = new EditMode(page, selectedIds);
      const blocks = mode.assemble();
      expect(blocks).toHaveLength(6);
      // DOM order: h1, p, p, p, h2, blockquote (IDs 0,1,2,4,6,7)
      expect(blocks[0].textContent).toBe('Article Title');
      expect(blocks[1].textContent).toBe('First paragraph.');
      expect(blocks[5].textContent.trim()).toBe('A quote');
    });

    it('wraps img as figure when inferred', () => {
      const mode = new EditMode(page, selectedIds);
      const img = page.querySelector('[data-pl-id="5"]');
      mode.add(img);
      const blocks = mode.assemble();
      const figureBlock = blocks.find((b) => b.tagName === 'FIGURE');
      expect(figureBlock).toBeDefined();
      expect(figureBlock.querySelector('img')).not.toBeNull();
    });

    it('applies reclassified tag to assembled block', () => {
      const mode = new EditMode(page, selectedIds);
      const p = page.querySelector('[data-pl-id="1"]');
      mode.reclassify(p, 'BLOCKQUOTE');
      const blocks = mode.assemble();
      // Second block should now be a blockquote
      expect(blocks[1].tagName).toBe('BLOCKQUOTE');
      expect(blocks[1].textContent).toBe('First paragraph.');
    });

    it('strips unsafe attributes from assembled blocks', () => {
      // Add tracking attributes to an element
      const p = page.querySelector('[data-pl-id="1"]');
      p.setAttribute('class', 'article-text tracked');
      p.setAttribute('onclick', 'trackClick()');
      p.setAttribute('data-analytics', 'true');

      const mode = new EditMode(page, selectedIds);
      const blocks = mode.assemble();
      const assembled = blocks.find((b) => b.textContent === 'First paragraph.');
      expect(assembled.hasAttribute('class')).toBe(false);
      expect(assembled.hasAttribute('onclick')).toBe(false);
      expect(assembled.hasAttribute('data-analytics')).toBe(false);
    });

    it('returns empty array when nothing is selected', () => {
      const mode = new EditMode(page, new Set());
      expect(mode.assemble()).toHaveLength(0);
    });
  });

  describe('assemble → parseBlocks round-trip', () => {
    it('assembled content survives parseBlocks pipeline', () => {
      const mode = new EditMode(page, selectedIds);
      const assembled = mode.assemble();

      // Serialize to HTML, run through parseBlocks (same as onConfirm handler)
      const container = document.createElement('div');
      for (const el of assembled) container.appendChild(el);
      const parsed = parseBlocks(container.innerHTML);

      // parseBlocks should produce valid blocks matching our assembled content
      expect(parsed.length).toBeGreaterThanOrEqual(5);
      expect(parsed[0].textContent).toBe('Article Title');
    });

    it('reclassified elements survive parseBlocks pipeline', () => {
      const mode = new EditMode(page, selectedIds);
      const p = page.querySelector('[data-pl-id="1"]');
      mode.reclassify(p, 'BLOCKQUOTE');
      const assembled = mode.assemble();

      const container = document.createElement('div');
      for (const el of assembled) container.appendChild(el);
      const parsed = parseBlocks(container.innerHTML);

      const bq = parsed.find((b) => b.tagName === 'BLOCKQUOTE' && b.textContent === 'First paragraph.');
      expect(bq).toBeDefined();
    });

    it('img→figure wrap survives parseBlocks pipeline', () => {
      const mode = new EditMode(page, selectedIds);
      const img = page.querySelector('[data-pl-id="5"]');
      mode.add(img);
      const assembled = mode.assemble();

      const container = document.createElement('div');
      for (const el of assembled) container.appendChild(el);
      const parsed = parseBlocks(container.innerHTML);

      const fig = parsed.find((b) => b.tagName === 'FIGURE');
      expect(fig).toBeDefined();
      expect(fig.querySelector('img')).not.toBeNull();
    });

    it('user-removed blocks are absent after round-trip', () => {
      const mode = new EditMode(page, selectedIds);
      mode.remove(page.querySelector('[data-pl-id="2"]')); // Remove "Second paragraph."
      const assembled = mode.assemble();

      const container = document.createElement('div');
      for (const el of assembled) container.appendChild(el);
      const parsed = parseBlocks(container.innerHTML);

      const hasSecond = parsed.some((b) => b.textContent === 'Second paragraph.');
      expect(hasSecond).toBe(false);
    });

    it('user-added blocks appear after round-trip', () => {
      const mode = new EditMode(page, selectedIds);
      const ad = page.querySelector('[data-pl-id="3"]'); // "Buy stuff!" - not in original selection
      mode.add(ad);
      const assembled = mode.assemble();

      const container = document.createElement('div');
      for (const el of assembled) container.appendChild(el);
      const parsed = parseBlocks(container.innerHTML);

      const hasAd = parsed.some((b) => b.textContent.includes('Buy stuff!'));
      expect(hasAd).toBe(true);
    });
  });
});

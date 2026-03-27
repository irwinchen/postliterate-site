import { describe, it, expect, beforeEach } from 'vitest';
import { tagElements, collectSurvivingIds, matchByTextFingerprint, cleanupElement, assembleBlocks } from '../content/element-tagger.js';

describe('tagElements', () => {
  it('stamps every element with sequential data-pl-id', () => {
    document.body.innerHTML = '<div><p>One</p><p>Two</p><h2>Three</h2></div>';
    tagElements(document.body);

    const all = document.body.querySelectorAll('[data-pl-id]');
    expect(all.length).toBeGreaterThanOrEqual(4); // div + 3 children
    // IDs are sequential strings
    const ids = Array.from(all).map((el) => el.getAttribute('data-pl-id'));
    expect(ids).toEqual(ids.map((_, i) => String(i)));
  });

  it('returns the total count of tagged elements', () => {
    document.body.innerHTML = '<p>A</p><p>B</p>';
    const count = tagElements(document.body);
    expect(count).toBe(2);
  });

  it('skips script and style elements', () => {
    document.body.innerHTML = '<p>Text</p><script>alert(1)</script><style>.x{}</style>';
    tagElements(document.body);

    const script = document.body.querySelector('script');
    const style = document.body.querySelector('style');
    expect(script.hasAttribute('data-pl-id')).toBe(false);
    expect(style.hasAttribute('data-pl-id')).toBe(false);
  });
});

describe('collectSurvivingIds', () => {
  it('extracts data-pl-id values from an HTML string', () => {
    const html = '<p data-pl-id="3">One</p><h2 data-pl-id="7">Two</h2>';
    const ids = collectSurvivingIds(html);
    expect(ids).toEqual(new Set(['3', '7']));
  });

  it('returns empty set for HTML with no data-pl-id', () => {
    const html = '<p>No IDs here</p>';
    const ids = collectSurvivingIds(html);
    expect(ids.size).toBe(0);
  });

  it('handles nested elements with IDs', () => {
    const html = '<div data-pl-id="1"><p data-pl-id="2">Nested</p></div>';
    const ids = collectSurvivingIds(html);
    expect(ids).toEqual(new Set(['1', '2']));
  });
});

describe('matchByTextFingerprint', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <article>
        <p data-pl-id="0">First paragraph of the article.</p>
        <p data-pl-id="1">Second paragraph with unique content.</p>
        <h2 data-pl-id="2">A heading</h2>
        <p data-pl-id="3">Third paragraph.</p>
      </article>
    `;
  });

  it('matches extracted text to an original element by normalized text content', () => {
    const extractedText = 'Second paragraph with unique content.';
    const match = matchByTextFingerprint(extractedText, document.body);
    expect(match).not.toBeNull();
    expect(match.getAttribute('data-pl-id')).toBe('1');
  });

  it('returns null when no match found', () => {
    const match = matchByTextFingerprint('This text does not exist anywhere.', document.body);
    expect(match).toBeNull();
  });

  it('normalizes whitespace for matching', () => {
    document.body.innerHTML = '<p data-pl-id="5">  Lots   of   spaces  </p>';
    const match = matchByTextFingerprint('Lots of spaces', document.body);
    expect(match).not.toBeNull();
    expect(match.getAttribute('data-pl-id')).toBe('5');
  });

  it('skips elements already in the found set', () => {
    document.body.innerHTML = '<p data-pl-id="0">Same text</p><p data-pl-id="1">Same text</p>';
    const alreadyFound = new Set();
    const match1 = matchByTextFingerprint('Same text', document.body, alreadyFound);
    expect(match1.getAttribute('data-pl-id')).toBe('0');

    alreadyFound.add(match1);
    const match2 = matchByTextFingerprint('Same text', document.body, alreadyFound);
    expect(match2.getAttribute('data-pl-id')).toBe('1');
  });
});

describe('cleanupElement', () => {
  it('strips classes and data attributes (except data-pl-id)', () => {
    document.body.innerHTML = '<p class="article-text" data-analytics="true" data-pl-id="5">Text</p>';
    const el = document.body.querySelector('p');
    const cleaned = cleanupElement(el);
    expect(cleaned.hasAttribute('class')).toBe(false);
    expect(cleaned.hasAttribute('data-analytics')).toBe(false);
    expect(cleaned.textContent).toBe('Text');
  });

  it('removes script and style children', () => {
    document.body.innerHTML = '<div><p>Keep</p><script>alert(1)</script><style>.x{}</style></div>';
    const el = document.body.querySelector('div');
    const cleaned = cleanupElement(el);
    expect(cleaned.querySelector('script')).toBeNull();
    expect(cleaned.querySelector('style')).toBeNull();
    expect(cleaned.querySelector('p').textContent).toBe('Keep');
  });

  it('removes inline event handlers', () => {
    document.body.innerHTML = '<p onclick="alert(1)" onmouseover="track()">Text</p>';
    const el = document.body.querySelector('p');
    const cleaned = cleanupElement(el);
    expect(cleaned.hasAttribute('onclick')).toBe(false);
    expect(cleaned.hasAttribute('onmouseover')).toBe(false);
  });

  it('wraps bare img in figure', () => {
    document.body.innerHTML = '<img src="photo.jpg" alt="A photo">';
    const el = document.body.querySelector('img');
    const cleaned = cleanupElement(el, 'FIGURE');
    expect(cleaned.tagName).toBe('FIGURE');
    expect(cleaned.querySelector('img')).not.toBeNull();
    expect(cleaned.querySelector('img').getAttribute('src')).toBe('photo.jpg');
  });

  it('preserves href on links', () => {
    document.body.innerHTML = '<p><a href="https://example.com" class="tracked-link" onclick="track()">Link</a></p>';
    const el = document.body.querySelector('p');
    const cleaned = cleanupElement(el);
    const link = cleaned.querySelector('a');
    expect(link.getAttribute('href')).toBe('https://example.com');
    expect(link.hasAttribute('class')).toBe(false);
    expect(link.hasAttribute('onclick')).toBe(false);
  });
});

describe('assembleBlocks', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div>
        <p data-pl-id="0">First</p>
        <p data-pl-id="1">Second</p>
        <h2 data-pl-id="2">Heading</h2>
        <p data-pl-id="3">Third</p>
        <p data-pl-id="4">Fourth</p>
      </div>
    `;
  });

  it('clones selected elements in DOM order', () => {
    const els = document.body.querySelectorAll('[data-pl-id="3"], [data-pl-id="0"], [data-pl-id="2"]');
    const selected = new Set(els);
    const blocks = assembleBlocks(selected);
    expect(blocks).toHaveLength(3);
    expect(blocks[0].textContent).toBe('First');
    expect(blocks[1].textContent).toBe('Heading');
    expect(blocks[2].textContent).toBe('Third');
  });

  it('returns empty array for empty selection', () => {
    const blocks = assembleBlocks(new Set());
    expect(blocks).toHaveLength(0);
  });

  it('applies cleanup to each block', () => {
    document.body.innerHTML = '<p data-pl-id="0" class="junk" onclick="track()">Clean me</p>';
    const el = document.body.querySelector('p');
    const blocks = assembleBlocks(new Set([el]));
    expect(blocks[0].hasAttribute('class')).toBe(false);
    expect(blocks[0].hasAttribute('onclick')).toBe(false);
    expect(blocks[0].textContent).toBe('Clean me');
  });
});

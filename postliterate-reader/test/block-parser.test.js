import { describe, it, expect } from 'vitest';
import { parseBlocks } from '../content/block-parser.js';

describe('parseBlocks', () => {
  it('parses HTML string into an array of block elements', () => {
    const html = '<p>First paragraph</p><p>Second paragraph</p>';
    const blocks = parseBlocks(html);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].tagName).toBe('P');
    expect(blocks[0].textContent).toBe('First paragraph');
    expect(blocks[1].textContent).toBe('Second paragraph');
  });

  it('handles headings, figures, blockquotes, lists, and pre', () => {
    const html = `
      <h2>Title</h2>
      <p>Text</p>
      <figure><img src="test.jpg" alt="test"><figcaption>Caption</figcaption></figure>
      <blockquote><p>A quote</p></blockquote>
      <ul><li>Item 1</li><li>Item 2</li></ul>
      <ol><li>First</li></ol>
      <pre><code>console.log('hi')</code></pre>
    `;
    const blocks = parseBlocks(html);
    const tags = blocks.map((b) => b.tagName);
    expect(tags).toEqual(['H2', 'P', 'FIGURE', 'BLOCKQUOTE', 'UL', 'OL', 'PRE']);
  });

  it('filters out empty and whitespace-only elements', () => {
    const html = '<p>Real content</p><p>   </p><p></p><div>   \n  </div><p>More content</p>';
    const blocks = parseBlocks(html);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].textContent).toBe('Real content');
    expect(blocks[1].textContent).toBe('More content');
  });

  it('wraps orphaned inline elements into a paragraph', () => {
    const html = '<p>Paragraph</p><span>Orphan span</span><em>Emphasis</em><p>Another</p>';
    const blocks = parseBlocks(html);
    expect(blocks).toHaveLength(3);
    expect(blocks[0].tagName).toBe('P');
    expect(blocks[1].tagName).toBe('P');
    expect(blocks[1].innerHTML).toContain('Orphan span');
    expect(blocks[1].innerHTML).toContain('Emphasis');
    expect(blocks[2].tagName).toBe('P');
  });

  it('preserves nested inline elements within block parents', () => {
    const html = '<p>Text with <strong>bold</strong> and <a href="#">links</a></p>';
    const blocks = parseBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].querySelector('strong')).not.toBeNull();
    expect(blocks[0].querySelector('a')).not.toBeNull();
  });

  it('handles Readability wrapper divs by flattening to their children', () => {
    // Readability often wraps content in <div> elements
    const html = '<div><p>Inside div 1</p><p>Inside div 2</p></div><p>Outside</p>';
    const blocks = parseBlocks(html);
    expect(blocks).toHaveLength(3);
    expect(blocks.every((b) => b.tagName === 'P')).toBe(true);
  });

  it('keeps divs that have no block-level children (treat as block)', () => {
    const html = '<div>This div has only text content</div><p>Paragraph</p>';
    const blocks = parseBlocks(html);
    expect(blocks).toHaveLength(2);
    // The div with only inline content stays as-is
    expect(blocks[0].textContent).toBe('This div has only text content');
  });

  it('returns empty array for empty input', () => {
    expect(parseBlocks('')).toEqual([]);
    expect(parseBlocks(null)).toEqual([]);
    expect(parseBlocks(undefined)).toEqual([]);
  });

  it('handles h1 through h6', () => {
    const html = '<h1>H1</h1><h2>H2</h2><h3>H3</h3><h4>H4</h4><h5>H5</h5><h6>H6</h6>';
    const blocks = parseBlocks(html);
    expect(blocks).toHaveLength(6);
    expect(blocks.map((b) => b.tagName)).toEqual(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
  });

  it('handles tables as single blocks', () => {
    const html = '<table><tr><td>Cell</td></tr></table>';
    const blocks = parseBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].tagName).toBe('TABLE');
  });

  it('handles hr as a block', () => {
    const html = '<p>Before</p><hr><p>After</p>';
    const blocks = parseBlocks(html);
    expect(blocks).toHaveLength(3);
    expect(blocks[1].tagName).toBe('HR');
  });

  it('filters out Wikipedia "From Wikipedia" preamble', () => {
    const html = '<p>From Wikipedia, the free encyclopedia</p><p>Real content</p>';
    const blocks = parseBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].textContent).toBe('Real content');
  });

  it('filters out Wikipedia redirect notices', () => {
    const html = '<p>(Redirected from Deep reading)</p><p>Real content</p>';
    const blocks = parseBlocks(html);
    expect(blocks).toHaveLength(1);
  });

  it('filters out standalone [edit] blocks', () => {
    const html = '<p>[edit]</p><p>Real content</p>';
    const blocks = parseBlocks(html);
    expect(blocks).toHaveLength(1);
  });

  it('removes Wikipedia edit section links from headings', () => {
    const html = '<h2>Philosophy <span class="mw-editsection">[<a href="#">edit</a>]</span></h2><p>Content</p>';
    const blocks = parseBlocks(html);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].textContent.trim()).toBe('Philosophy');
  });

  it('flattens section and article wrappers into child blocks', () => {
    const html = '<section><p>Para 1</p><p>Para 2</p><h2>Heading</h2><p>Para 3</p></section>';
    const blocks = parseBlocks(html);
    expect(blocks).toHaveLength(4);
    expect(blocks.map((b) => b.tagName)).toEqual(['P', 'P', 'H2', 'P']);
  });

  it('flattens nested section > div > p structures', () => {
    const html = '<article><section><div><p>Deep para 1</p><p>Deep para 2</p></div></section></article>';
    const blocks = parseBlocks(html);
    expect(blocks).toHaveLength(2);
    expect(blocks.every((b) => b.tagName === 'P')).toBe(true);
  });

  it('filters out common site chrome artifacts', () => {
    const html = '<p>Real content</p><p>Advertisement</p><p>Share this article</p><p>Related articles</p><p>More content</p>';
    const blocks = parseBlocks(html);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].textContent).toBe('Real content');
    expect(blocks[1].textContent).toBe('More content');
  });

  it('filters out promotional headings like "You might also like"', () => {
    const html = '<p>Real content</p><h2>You might also like</h2><ul><li><a href="/a">Article A</a></li></ul><p>More content</p>';
    const blocks = parseBlocks(html);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].textContent).toBe('Real content');
    expect(blocks[1].textContent).toBe('More content');
  });

  it('filters out "Recommended" and "Trending" promotional headings', () => {
    const html = '<p>Content</p><h3>Recommended</h3><h3>Trending</h3><h2>What to Read Next</h2>';
    const blocks = parseBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].textContent).toBe('Content');
  });

  it('filters out link-heavy lists (nav/promo lists)', () => {
    const html = `
      <ul>
        <li>Real item with text content that is substantial</li>
        <li>Another real item</li>
      </ul>
      <ul>
        <li><a href="/a">Link only</a></li>
        <li><a href="/b">Another link</a></li>
        <li><a href="/c">Third link</a></li>
      </ul>
      <p>Real content</p>
    `;
    const blocks = parseBlocks(html);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].tagName).toBe('UL');
    expect(blocks[0].textContent).toContain('Real item');
    expect(blocks[1].textContent).toBe('Real content');
  });

  it('keeps lists where links are mixed with substantial text', () => {
    const html = `
      <ul>
        <li>This point references <a href="/x">a source</a> with more explanation after</li>
        <li>Another detailed point with <a href="/y">citation</a></li>
      </ul>
    `;
    const blocks = parseBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].tagName).toBe('UL');
  });

  it('filters out NYTimes-style image credit artifacts', () => {
    const html = '<p>Real content</p><p>Credit...The New York Times</p><p>By Someone for The Times</p>';
    const blocks = parseBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].textContent).toBe('Real content');
  });

  it('filters out figures with only tiny/tracking images', () => {
    const html = '<figure><img src="pixel.gif" width="1" height="1"></figure><figure><img src="photo.jpg" alt="A real photo"></figure><p>Content</p>';
    const blocks = parseBlocks(html);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].tagName).toBe('FIGURE');
    expect(blocks[0].querySelector('img').alt).toBe('A real photo');
    expect(blocks[1].textContent).toBe('Content');
  });

  it('filters out figures with no real image src', () => {
    const html = '<figure><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></figure><p>Content</p>';
    const blocks = parseBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].textContent).toBe('Content');
  });

  it('keeps figures that contain both a tracking pixel and a real image', () => {
    const html = '<figure><img src="pixel.gif" width="1" height="1"><img src="photo.jpg" alt="Real"></figure><p>Content</p>';
    const blocks = parseBlocks(html);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].tagName).toBe('FIGURE');
  });
});

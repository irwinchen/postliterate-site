import { describe, it, expect } from 'vitest';
import { convertReductoToHtml, extractPdfMetadata } from '../lib/reducto.js';

// --- Fixture helpers ---

function makeResult(blocks, numPages = 1) {
  return {
    job_id: 'test-job',
    duration: 1.5,
    usage: { num_pages: numPages },
    result: {
      type: 'full',
      chunks: [{ blocks }],
    },
  };
}

function block(type, content, extra = {}) {
  return { type, content, confidence: 'high', bbox: {}, ...extra };
}

// --- convertReductoToHtml ---

describe('convertReductoToHtml', () => {
  it('converts Title blocks to <h1>', () => {
    const result = makeResult([block('Title', 'My Paper Title')]);
    const { html } = convertReductoToHtml(result);
    expect(html).toContain('<h1>My Paper Title</h1>');
  });

  it('converts Section Header blocks to <h2>', () => {
    const result = makeResult([block('Section Header', 'Introduction')]);
    const { html } = convertReductoToHtml(result);
    expect(html).toContain('<h2>Introduction</h2>');
  });

  it('converts Text blocks to <p>', () => {
    const result = makeResult([block('Text', 'A paragraph of text.')]);
    const { html } = convertReductoToHtml(result);
    expect(html).toContain('<p>A paragraph of text.</p>');
  });

  it('groups consecutive List Item blocks into a single <ul>', () => {
    const result = makeResult([
      block('List Item', 'First item'),
      block('List Item', 'Second item'),
      block('List Item', 'Third item'),
    ]);
    const { html } = convertReductoToHtml(result);
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>First item</li>');
    expect(html).toContain('<li>Second item</li>');
    expect(html).toContain('<li>Third item</li>');
    expect(html).toContain('</ul>');
    // Should be a single <ul>, not three
    const ulCount = (html.match(/<ul>/g) || []).length;
    expect(ulCount).toBe(1);
  });

  it('flushes list when interrupted by a non-list block', () => {
    const result = makeResult([
      block('List Item', 'Item A'),
      block('List Item', 'Item B'),
      block('Text', 'A paragraph between lists.'),
      block('List Item', 'Item C'),
    ]);
    const { html } = convertReductoToHtml(result);
    const ulCount = (html.match(/<ul>/g) || []).length;
    expect(ulCount).toBe(2);
    expect(html).toContain('<p>A paragraph between lists.</p>');
  });

  it('converts Table blocks preserving HTML content', () => {
    const tableHtml = '<table><tr><td>Cell</td></tr></table>';
    const result = makeResult([block('Table', tableHtml)]);
    const { html } = convertReductoToHtml(result);
    expect(html).toContain('<table>');
    expect(html).toContain('<td>Cell</td>');
  });

  it('converts Figure blocks with image_url', () => {
    const result = makeResult([
      block('Figure', 'Figure 1: A chart', { image_url: 'https://example.com/chart.png' }),
    ]);
    const { html } = convertReductoToHtml(result);
    expect(html).toContain('<figure>');
    expect(html).toContain('<img src="https://example.com/chart.png"');
    expect(html).toContain('<figcaption>Figure 1: A chart</figcaption>');
    expect(html).toContain('</figure>');
  });

  it('converts Figure blocks without image_url as figcaption-only', () => {
    const result = makeResult([block('Figure', 'Figure 2: Description only')]);
    const { html } = convertReductoToHtml(result);
    expect(html).toContain('<figure>');
    expect(html).toContain('<figcaption>Figure 2: Description only</figcaption>');
    expect(html).not.toContain('<img');
  });

  it('skips Header blocks (page artifacts)', () => {
    const result = makeResult([
      block('Header', 'Journal of Science Vol. 12'),
      block('Text', 'Actual content.'),
    ]);
    const { html } = convertReductoToHtml(result);
    expect(html).not.toContain('Journal of Science');
    expect(html).toContain('<p>Actual content.</p>');
  });

  it('skips Footer blocks (page artifacts)', () => {
    const result = makeResult([
      block('Text', 'Content here.'),
      block('Footer', 'Page 1 of 10'),
    ]);
    const { html } = convertReductoToHtml(result);
    expect(html).not.toContain('Page 1 of 10');
    expect(html).toContain('<p>Content here.</p>');
  });

  it('skips Page Number blocks', () => {
    const result = makeResult([
      block('Page Number', '42'),
      block('Text', 'Real text.'),
    ]);
    const { html } = convertReductoToHtml(result);
    expect(html).not.toContain('42');
    expect(html).toContain('<p>Real text.</p>');
  });

  it('skips blocks with empty content', () => {
    const result = makeResult([
      block('Text', ''),
      block('Text', '   '),
      block('Text', 'Non-empty.'),
    ]);
    const { html } = convertReductoToHtml(result);
    const pCount = (html.match(/<p>/g) || []).length;
    expect(pCount).toBe(1);
    expect(html).toContain('<p>Non-empty.</p>');
  });

  it('converts Key Value blocks to <p> with bold key', () => {
    const result = makeResult([block('Key Value', 'Author: John Smith')]);
    const { html } = convertReductoToHtml(result);
    expect(html).toContain('<p>');
    expect(html).toContain('Author: John Smith');
  });

  it('converts Comment blocks to <blockquote>', () => {
    const result = makeResult([block('Comment', 'This is a marginal note.')]);
    const { html } = convertReductoToHtml(result);
    expect(html).toContain('<blockquote>');
    expect(html).toContain('This is a marginal note.');
  });

  it('handles a full multi-block document', () => {
    const result = makeResult([
      block('Header', 'ACME Journal'),
      block('Title', 'Deep Reading in the Digital Age'),
      block('Text', 'Abstract: This paper explores...'),
      block('Section Header', '1. Introduction'),
      block('Text', 'Reading habits have changed dramatically.'),
      block('List Item', 'Attention spans are shorter'),
      block('List Item', 'Digital distractions are pervasive'),
      block('Text', 'We propose a new approach.'),
      block('Figure', 'Figure 1: Reading patterns', { image_url: 'https://example.com/fig1.png' }),
      block('Section Header', '2. Methods'),
      block('Text', 'We conducted a study with 100 participants.'),
      block('Table', '<table><tr><th>Group</th><th>Score</th></tr><tr><td>A</td><td>85</td></tr></table>'),
      block('Footer', 'Page 1'),
      block('Page Number', '1'),
    ]);
    const { html, title } = convertReductoToHtml(result);

    // Title extracted
    expect(title).toBe('Deep Reading in the Digital Age');

    // Artifacts skipped
    expect(html).not.toContain('ACME Journal');
    expect(html).not.toContain('Page 1');

    // Structure preserved
    expect(html).toContain('<h1>Deep Reading in the Digital Age</h1>');
    expect(html).toContain('<h2>1. Introduction</h2>');
    expect(html).toContain('<h2>2. Methods</h2>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>Attention spans are shorter</li>');
    expect(html).toContain('<figure>');
    expect(html).toContain('<table>');
  });

  it('handles multiple chunks by concatenating blocks in order', () => {
    const result = {
      job_id: 'test',
      duration: 1,
      usage: { num_pages: 2 },
      result: {
        type: 'full',
        chunks: [
          { blocks: [block('Title', 'Page One Title'), block('Text', 'First page text.')] },
          { blocks: [block('Text', 'Second page text.'), block('Text', 'More text.')] },
        ],
      },
    };
    const { html } = convertReductoToHtml(result);
    expect(html).toContain('<h1>Page One Title</h1>');
    expect(html).toContain('<p>First page text.</p>');
    expect(html).toContain('<p>Second page text.</p>');
    expect(html).toContain('<p>More text.</p>');
  });

  it('escapes HTML entities in text content', () => {
    const result = makeResult([block('Text', 'x < y && y > z')]);
    const { html } = convertReductoToHtml(result);
    expect(html).toContain('&lt;');
    expect(html).toContain('&amp;');
    expect(html).not.toContain('<p>x < y');
  });

  it('does not double-escape Table content (already HTML)', () => {
    const tableContent = '<table><tr><td>A &amp; B</td></tr></table>';
    const result = makeResult([block('Table', tableContent)]);
    const { html } = convertReductoToHtml(result);
    expect(html).toContain('A &amp; B');
    expect(html).not.toContain('&amp;amp;');
  });

  it('converts **bold** and *italic* markdown in text to HTML', () => {
    const result = makeResult([
      block('Text', 'This has **bold text** and *italic text* in it.'),
    ]);
    const { html } = convertReductoToHtml(result);
    expect(html).toContain('<strong>bold text</strong>');
    expect(html).toContain('<em>italic text</em>');
    expect(html).not.toContain('**');
    expect(html).not.toContain('*italic');
  });

  it('converts markdown-style pipe tables in Text blocks to <table>', () => {
    const tableText = '| Group | Score |\n|---|---|\n| A | 85 |\n| B | 72 |';
    const result = makeResult([block('Text', tableText)]);
    const { html } = convertReductoToHtml(result);
    expect(html).toContain('<table>');
    expect(html).toContain('<th>');
    expect(html).toContain('Group');
    expect(html).toContain('<td>');
    expect(html).toContain('85');
    expect(html).not.toContain('|');
  });

  it('does not treat single pipes in text as tables', () => {
    const result = makeResult([block('Text', 'Use x | y for alternatives.')]);
    const { html } = convertReductoToHtml(result);
    expect(html).toContain('<p>');
    expect(html).not.toContain('<table>');
  });

  it('converts markdown-style tables in Table blocks too', () => {
    const tableText = '| Name | Value |\n|---|---|\n| X | 10 |';
    const result = makeResult([block('Table', tableText)]);
    const { html } = convertReductoToHtml(result);
    expect(html).toContain('<table>');
    expect(html).toContain('<th>');
    expect(html).toContain('Name');
  });

  it('returns empty html for empty block list', () => {
    const result = makeResult([]);
    const { html, title } = convertReductoToHtml(result);
    expect(html).toBe('');
    expect(title).toBeNull();
  });
});

// --- extractPdfMetadata ---

describe('extractPdfMetadata', () => {
  it('extracts title from first Title block', () => {
    const result = makeResult([
      block('Header', 'Journal Name'),
      block('Title', 'The Real Title'),
      block('Text', 'Some content.'),
    ]);
    const meta = extractPdfMetadata(result);
    expect(meta.title).toBe('The Real Title');
  });

  it('prefers the longest Title block as the document title', () => {
    const result = makeResult([
      block('Title', 'cognitive_surrender'),
      block('Title', 'Thinking—Fast, Slow, and Artificial: How AI is Reshaping Human Reasoning'),
      block('Text', 'Some content.'),
    ]);
    const meta = extractPdfMetadata(result);
    expect(meta.title).toBe('Thinking—Fast, Slow, and Artificial: How AI is Reshaping Human Reasoning');
  });

  it('skips filename-like titles (underscores, no spaces)', () => {
    const result = makeResult([
      block('Title', 'my_paper_draft_v2'),
      block('Title', 'The Real Paper Title'),
      block('Text', 'Content.'),
    ]);
    const meta = extractPdfMetadata(result);
    expect(meta.title).toBe('The Real Paper Title');
  });

  it('convertReductoToHtml also uses best title', () => {
    const result = makeResult([
      block('Title', 'cognitive_surrender'),
      block('Title', 'Thinking—Fast, Slow, and Artificial'),
      block('Text', 'Content.'),
    ]);
    const { title } = convertReductoToHtml(result);
    expect(title).toBe('Thinking—Fast, Slow, and Artificial');
  });

  it('returns null title when no Title block exists', () => {
    const result = makeResult([
      block('Text', 'Just text.'),
      block('Section Header', 'A section.'),
    ]);
    const meta = extractPdfMetadata(result);
    expect(meta.title).toBeNull();
  });

  it('extracts page count from usage', () => {
    const result = makeResult([block('Text', 'Content')], 15);
    const meta = extractPdfMetadata(result);
    expect(meta.pageCount).toBe(15);
  });

  it('counts words across all text blocks', () => {
    const result = makeResult([
      block('Title', 'Two Words'),
      block('Text', 'Three more words'),
      block('Section Header', 'And two'),
      block('Header', 'Skip this'),  // page artifact, should be excluded
    ]);
    const meta = extractPdfMetadata(result);
    // "Two Words" + "Three more words" + "And two" = 2 + 3 + 2 = 7
    expect(meta.wordCount).toBe(7);
  });
});

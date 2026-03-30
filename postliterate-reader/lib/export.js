/**
 * Export module — PDF (print), HTML, and Markdown export for articles.
 */

import { blocksToMarkdown } from './html-to-markdown.js';

/**
 * Slugify a title for use as a filename.
 */
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 60)
    .replace(/-$/, '');
}

/**
 * Trigger a file download from a Blob.
 */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 100);
}

/**
 * Export via the browser's print dialog (PDF or printer).
 */
export function exportPdf() {
  window.print();
}

/**
 * Export as a standalone HTML file.
 * @param {Object} article - { title, byline, siteName, publishDate, contentHtml }
 */
export function exportHtml(article) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(article.title || 'Article')}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Literata:ital,wght@0,400;0,500;1,400&family=Outfit:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Literata', Georgia, serif;
      font-size: 18px;
      line-height: 1.7;
      color: #2C2C2C;
      background: #F3EFE1;
      max-width: 680px;
      margin-inline: auto;
      padding: 48px 24px;
    }
    h1, h2, h3, h4, h5, h6 {
      font-family: 'Outfit', system-ui, sans-serif;
      line-height: 1.2;
      margin-block: 1.5em 0.5em;
    }
    h1 { font-size: 2em; font-weight: 600; text-wrap: balance; }
    h2 { font-size: 1.5em; font-weight: 500; }
    h3 { font-size: 1.2em; font-weight: 500; }
    p { margin-block-end: 1em; text-wrap: pretty; }
    blockquote {
      border-inline-start: 3px solid #E53E33;
      padding-inline-start: 1em;
      margin-block: 1em;
      font-style: italic;
    }
    figure { margin-block: 1.5em; }
    figure img { max-width: 100%; height: auto; }
    figcaption { font-size: 0.85em; color: #666; margin-block-start: 0.5em; }
    pre { background: #f5f5f0; padding: 1em; overflow-x: auto; font-size: 0.9em; }
    code { font-family: 'Sono', monospace; }
    a { color: #3B6DB4; }
    .article-meta {
      font-family: 'Outfit', system-ui, sans-serif;
      font-size: 14px;
      color: #999;
      margin-block-end: 8px;
    }
    .article-byline {
      font-family: 'Outfit', system-ui, sans-serif;
      font-size: 16px;
      color: #666;
      margin-block-end: 2em;
    }
    hr { border: none; border-block-start: 1px solid #ddd; margin-block: 2em; }
  </style>
</head>
<body>
  <article>
    ${article.siteName || article.publishDate ? `<div class="article-meta">${escapeHtml(article.siteName || '')}${article.siteName && article.publishDate ? ' \u00B7 ' : ''}${escapeHtml(article.publishDate || '')}</div>` : ''}
    <h1>${escapeHtml(article.title || '')}</h1>
    ${article.byline ? `<div class="article-byline">${escapeHtml(article.byline)}</div>` : ''}
    ${article.contentHtml}
  </article>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  downloadBlob(blob, `${slugify(article.title || 'article')}.html`);
}

/**
 * Export as Markdown.
 * @param {Object} article - { title, byline, siteName, publishDate, contentHtml }
 * @param {Element[]} blocks - Parsed block elements
 */
export function exportMarkdown(article, blocks) {
  const header = [];
  if (article.siteName || article.publishDate) {
    const parts = [article.siteName, article.publishDate].filter(Boolean);
    header.push(parts.join(' \u00B7 '));
  }
  header.push(`# ${article.title || 'Untitled'}`);
  if (article.byline) header.push(`*${article.byline}*`);
  header.push('');

  const body = blocksToMarkdown(blocks);
  const md = header.join('\n\n') + '\n' + body;

  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  downloadBlob(blob, `${slugify(article.title || 'article')}.md`);
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

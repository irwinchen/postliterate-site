/**
 * Viewer page — loads a saved article from IndexedDB and mounts
 * the reading overlay. Reuses createReadingOverlay from reading-ui.js.
 */

import { createReadingOverlay } from '../content/reading-ui.js';

async function init() {
  // Extract article ID from URL params
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if (!id) {
    document.body.textContent = 'No article ID provided.';
    return;
  }

  // Fetch article from service worker
  const resp = await chrome.runtime.sendMessage({ action: 'get-article', id });
  if (!resp?.success || !resp.article) {
    document.body.textContent = 'Article not found.';
    return;
  }

  const article = resp.article;

  // Load user settings
  const settings = await chrome.storage.local.get([
    'theme', 'speed', 'readingMode',
    'fontBody', 'fontHeading', 'fontCode',
  ]);

  // Load extension CSS
  const cssUrl = chrome.runtime.getURL('content/styles.css');
  const cssResp = await fetch(cssUrl);
  const cssText = cssResp.ok ? await cssResp.text() : '';

  // Inject bundled @font-face rules into document head
  const fontsUrl = chrome.runtime.getURL('fonts/');
  const fontStyle = document.createElement('style');
  fontStyle.id = 'pl-fonts';
  fontStyle.textContent = `
    @font-face {
      font-family: 'Outfit';
      src: url('${fontsUrl}outfit-400.woff2') format('woff2');
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: 'Outfit';
      src: url('${fontsUrl}outfit-500.woff2') format('woff2');
      font-weight: 500;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: 'Outfit';
      src: url('${fontsUrl}outfit-600.woff2') format('woff2');
      font-weight: 600;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: 'Literata';
      src: url('${fontsUrl}literata-400.woff2') format('woff2');
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: 'Literata';
      src: url('${fontsUrl}literata-400i.woff2') format('woff2');
      font-weight: 400;
      font-style: italic;
      font-display: swap;
    }
    @font-face {
      font-family: 'Literata';
      src: url('${fontsUrl}literata-500.woff2') format('woff2');
      font-weight: 500;
      font-style: normal;
      font-display: swap;
    }
    @font-face {
      font-family: 'Sono';
      src: url('${fontsUrl}sono-400.woff2') format('woff2');
      font-weight: 400;
      font-style: normal;
      font-display: swap;
    }
  `;
  document.head.appendChild(fontStyle);

  // Set page title
  document.title = article.title || 'Virgil Reader';

  // Create and mount the reading overlay
  const overlay = createReadingOverlay({
    title: article.title || '',
    byline: article.byline || '',
    siteName: article.siteName || '',
    faviconUrl: article.faviconUrl || '',
    publishDate: article.publishDate || '',
    contentHtml: article.contentHtml,
    cssText,
    settings,
    originalStyles: article.originalStyles || null,
    savedArticleId: article.id,
  });

  document.body.appendChild(overlay);
}

init();

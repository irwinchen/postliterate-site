/**
 * Content script — injected into the active tab to extract content
 * and create the reading overlay.
 *
 * Expects ReadabilityLib to be available as a global (injected before this script).
 */

import { createReadingOverlay } from './reading-ui.js';

/**
 * Snapshot computed styles from the original page before extraction.
 * Used for "Original Style" rendering mode.
 */
function snapshotOriginalStyles() {
  const styles = {};
  const selectors = [
    { key: 'font-body', sel: 'article p, main p, .post p, p' },
    { key: 'font-heading', sel: 'article h2, main h2, .post h2, h2' },
    { key: 'font-mono', sel: 'code, pre code' },
    { key: 'color-text', sel: 'article, main, .post, body' },
    { key: 'color-bg', sel: 'body' },
    { key: 'color-link', sel: 'a' },
    { key: 'size-body', sel: 'article p, main p, .post p, p' },
    { key: 'lh-body', sel: 'article p, main p, .post p, p' },
  ];

  for (const { key, sel } of selectors) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const cs = getComputedStyle(el);

    if (key.startsWith('font-')) {
      styles[key] = cs.fontFamily;
    } else if (key.startsWith('color-')) {
      if (key === 'color-bg') {
        styles[key] = cs.backgroundColor;
      } else {
        styles[key] = cs.color;
      }
    } else if (key.startsWith('size-')) {
      styles[key] = cs.fontSize;
    } else if (key.startsWith('lh-')) {
      styles[key] = cs.lineHeight;
    }
  }

  return styles;
}

/**
 * Extract article content using Readability.js.
 */
function extractArticle() {
  // ReadabilityLib is injected as an IIFE global
  const { Readability, isProbablyReaderable } = window.ReadabilityLib;

  // Check if page looks like it has readable content
  if (!isProbablyReaderable(document)) {
    return null;
  }

  // Clone the document to avoid mutating the original page
  const clone = document.cloneNode(true);
  const reader = new Readability(clone);
  return reader.parse();
}

/**
 * Initialize the reader when triggered by the service worker.
 */
async function init(settings = {}) {
  // Check if reader is already active
  if (document.getElementById('postliterate-reader')) {
    // Toggle off
    document.getElementById('postliterate-reader').remove();
    document.body.style.overflow = '';
    return { success: false, reason: 'toggled-off' };
  }

  // Snapshot original styles before any DOM changes
  const originalStyles = snapshotOriginalStyles();

  // Extract article
  const article = extractArticle();

  if (!article || !article.content) {
    return {
      success: false,
      reason: 'extraction-failed',
      message: 'Could not extract article content from this page.',
    };
  }

  // Fetch the extension CSS
  const cssUrl = chrome.runtime.getURL('content/styles.css');
  const cssResponse = await fetch(cssUrl);
  const cssText = await cssResponse.text();

  // Resolve font URLs in CSS
  const fontsUrl = chrome.runtime.getURL('fonts/');
  const resolvedCss = cssText + `
    @font-face {
      font-family: 'Outfit';
      src: url('${fontsUrl}outfit-400.woff2') format('woff2');
      font-weight: 400;
      font-display: swap;
    }
    @font-face {
      font-family: 'Outfit';
      src: url('${fontsUrl}outfit-500.woff2') format('woff2');
      font-weight: 500;
      font-display: swap;
    }
    @font-face {
      font-family: 'Outfit';
      src: url('${fontsUrl}outfit-600.woff2') format('woff2');
      font-weight: 600;
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
      font-display: swap;
    }
  `;

  // Create the reading overlay
  const overlay = createReadingOverlay({
    title: article.title,
    byline: article.byline || article.siteName || '',
    contentHtml: article.content,
    cssText: resolvedCss,
    settings,
    originalStyles,
  });

  return {
    success: true,
    title: article.title,
    url: window.location.href,
  };
}

// Listen for messages from service worker / popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'toggle-reader') {
    init(message.settings || {}).then(sendResponse);
    return true; // async response
  }
  if (message.action === 'get-status') {
    const reader = document.getElementById('postliterate-reader');
    sendResponse({ active: !!reader });
    return false;
  }
});

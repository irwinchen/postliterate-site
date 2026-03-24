/**
 * Content script — injected into the active tab to extract content
 * and create the reading overlay.
 *
 * Expects ReadabilityLib to be available as a global (injected before this script).
 */

import { createReadingOverlay } from './reading-ui.js';
import { tagElements, collectSurvivingIds, matchByTextFingerprint } from './element-tagger.js';

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
 * Pre-tags elements so we can map Readability output back to originals.
 *
 * Returns { article, selectedIds } where selectedIds is the set of
 * data-pl-id values that Readability kept.
 */
function extractArticle() {
  // ReadabilityLib is injected as an IIFE global
  const { Readability, isProbablyReaderable } = window.ReadabilityLib;

  // Check if page looks like it has readable content
  if (!isProbablyReaderable(document)) {
    return { article: null, selectedIds: new Set() };
  }

  // Pre-tag every element in the original page
  tagElements(document.body);

  // Clone the document (clone inherits data-pl-id attributes)
  const clone = document.cloneNode(true);
  const reader = new Readability(clone);
  const article = reader.parse();

  // Collect which original elements survived Readability's extraction
  let selectedIds = new Set();
  if (article && article.content) {
    selectedIds = collectSurvivingIds(article.content);

    // For extracted blocks without data-pl-id (Readability-created wrappers),
    // fall back to text fingerprint matching
    const container = document.createElement('div');
    container.innerHTML = article.content;
    const alreadyFound = new Set();
    for (const el of container.querySelectorAll(':scope > *')) {
      if (!el.hasAttribute('data-pl-id')) {
        const text = el.textContent.trim();
        if (text) {
          const match = matchByTextFingerprint(text, document.body, alreadyFound);
          if (match) {
            const id = match.getAttribute('data-pl-id');
            if (id) selectedIds.add(id);
            alreadyFound.add(match);
          }
        }
      }
    }
  }

  return { article, selectedIds };
}

/**
 * Get the site's favicon URL.
 */
function getFaviconUrl() {
  // Try explicit link tags in order of preference
  const selectors = [
    'link[rel="icon"][type="image/svg+xml"]',
    'link[rel="apple-touch-icon"]',
    'link[rel="icon"][sizes="32x32"]',
    'link[rel="icon"][sizes="16x16"]',
    'link[rel="icon"]',
    'link[rel="shortcut icon"]',
  ];
  for (const sel of selectors) {
    const link = document.querySelector(sel);
    if (link?.href) return link.href;
  }
  // Fallback to /favicon.ico
  return new URL('/favicon.ico', window.location.origin).href;
}

/**
 * Extract publication date from page metadata.
 */
function getPublicationDate() {
  // Try meta tags (most common patterns)
  const metaSelectors = [
    'meta[property="article:published_time"]',
    'meta[name="date"]',
    'meta[name="publish-date"]',
    'meta[name="DC.date"]',
    'meta[property="og:article:published_time"]',
    'meta[name="article.published"]',
    'time[datetime]',
  ];
  for (const sel of metaSelectors) {
    const el = document.querySelector(sel);
    const value = el?.getAttribute('content') || el?.getAttribute('datetime');
    if (value) {
      const date = new Date(value);
      if (!isNaN(date)) {
        return date.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
      }
    }
  }
  // Try JSON-LD
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(script.textContent);
      const dateStr = data.datePublished || data.dateCreated;
      if (dateStr) {
        const date = new Date(dateStr);
        if (!isNaN(date)) {
          return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          });
        }
      }
    } catch { /* ignore malformed JSON-LD */ }
  }
  return null;
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
  const { article, selectedIds } = extractArticle();

  if (!article || !article.content) {
    return {
      success: false,
      reason: 'extraction-failed',
      message: 'Could not extract article content from this page.',
    };
  }

  // Fetch the extension CSS
  const cssUrl = chrome.runtime.getURL('content/styles.css');
  const cssResponse = await fetch(cssUrl, { cache: 'no-store' });
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

  // Gather publication metadata
  const faviconUrl = getFaviconUrl();
  const siteName = article.siteName || '';
  const publishDate = getPublicationDate();

  // Create the reading overlay
  const overlay = createReadingOverlay({
    title: article.title,
    byline: article.byline || '',
    siteName,
    faviconUrl,
    publishDate,
    contentHtml: article.content,
    cssText: resolvedCss,
    settings,
    originalStyles,
    selectedIds,
  });

  // If editFirst flag is set, go straight into edit mode
  if (settings.editFirst && selectedIds.size > 0) {
    overlay.enterEditMode();
  }

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

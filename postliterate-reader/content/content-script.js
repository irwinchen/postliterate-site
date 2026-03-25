/**
 * Content script — injected into the active tab to extract content
 * and create the reading overlay.
 *
 * Expects ReadabilityLib to be available as a global (injected before this script).
 */

import { createReadingOverlay } from './reading-ui.js';
import { tagElements, collectSurvivingIds, matchByTextFingerprint } from './element-tagger.js';

/**
 * Find the first matching element from an array of selectors (tried in priority order).
 * Unlike comma-separated selectors, this checks each selector individually
 * so we prefer article content over random page elements.
 */
function findBestElement(selectorList) {
  for (const sel of selectorList) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

/**
 * Find the most common font-family among multiple paragraph elements.
 * Samples paragraphs with substantial text (>80 chars) to skip subheads/captions.
 * Returns a representative element with that font for size/line-height measurement.
 */
function findBodyFontElement(selectorList) {
  const MIN_TEXT_LENGTH = 80;
  for (const sel of selectorList) {
    const els = document.querySelectorAll(sel);
    if (els.length === 0) continue;

    const fontCounts = new Map();
    let longestEl = null;
    let longestLen = 0;

    for (const el of els) {
      const textLen = el.textContent.trim().length;
      if (textLen > longestLen) {
        longestLen = textLen;
        longestEl = el;
      }
      if (textLen < MIN_TEXT_LENGTH) continue;
      const font = getComputedStyle(el).fontFamily;
      fontCounts.set(font, (fontCounts.get(font) || 0) + 1);
    }

    // Return the most common font among substantial paragraphs
    if (fontCounts.size > 0) {
      let bestFont = null;
      let bestCount = 0;
      for (const [font, count] of fontCounts) {
        if (count > bestCount) {
          bestFont = font;
          bestCount = count;
        }
      }
      // Find a representative element with this font
      for (const el of els) {
        if (el.textContent.trim().length >= MIN_TEXT_LENGTH &&
            getComputedStyle(el).fontFamily === bestFont) {
          return el;
        }
      }
    }

    // Fallback: longest paragraph in this selector group
    if (longestEl) return longestEl;
  }
  return document.querySelector('body');
}

/**
 * Snapshot computed styles from the original page before extraction.
 * Selectors are ordered by specificity — article content first, then generic fallbacks.
 */
function snapshotOriginalStyles() {
  const styles = {};

  // Body text — sample multiple paragraphs, pick the most common font
  // (avoids mistaking subhead/summary fonts for body text)
  const bodyEl = findBodyFontElement([
    'article p, [role="article"] p',
    'main p',
    '.post-content p, .article-body p, .story-body p, .entry-content p',
    'p',
  ]);
  if (bodyEl) {
    const cs = getComputedStyle(bodyEl);
    styles['font-body'] = cs.fontFamily;
    styles['size-body'] = cs.fontSize;
    styles['lh-body'] = cs.lineHeight;
  }

  // Headings — prefer h1 (article title)
  const headingEl = findBestElement([
    'article h1', '[role="article"] h1', 'main h1', 'h1',
    'article h2', 'main h2', 'h2',
  ]);
  if (headingEl) {
    styles['font-heading'] = getComputedStyle(headingEl).fontFamily;
  }

  // Code
  const codeEl = findBestElement(['article code', 'main code', 'pre code', 'code']);
  if (codeEl) {
    styles['font-mono'] = getComputedStyle(codeEl).fontFamily;
  }

  // Colors
  const textEl = findBestElement(['article', '[role="article"]', 'main', '.post', 'body']);
  if (textEl) {
    styles['color-text'] = getComputedStyle(textEl).color;
  }

  const bgEl = document.querySelector('body');
  if (bgEl) {
    styles['color-bg'] = getComputedStyle(bgEl).backgroundColor;
  }

  const linkEl = findBestElement(['article a', 'main a', 'a']);
  if (linkEl) {
    styles['color-link'] = getComputedStyle(linkEl).color;
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

  // Inject @font-face in document scope (shadow DOM doesn't reliably load fonts)
  if (!document.getElementById('pl-fonts')) {
    const fontsUrl = chrome.runtime.getURL('fonts/');

    // Collect the page's own @font-face rules so they're available in shadow DOM
    let pageFontFaces = '';
    try {
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            if (rule instanceof CSSFontFaceRule) {
              pageFontFaces += rule.cssText + '\n';
            }
          }
        } catch { /* CORS-restricted stylesheet — skip */ }
      }
    } catch { /* no stylesheets — skip */ }

    const fontStyle = document.createElement('style');
    fontStyle.id = 'pl-fonts';
    fontStyle.textContent = `
      ${pageFontFaces}
      @font-face { font-family: 'Outfit'; src: url('${fontsUrl}outfit-400.woff2') format('woff2'); font-weight: 400; font-display: swap; }
      @font-face { font-family: 'Outfit'; src: url('${fontsUrl}outfit-500.woff2') format('woff2'); font-weight: 500; font-display: swap; }
      @font-face { font-family: 'Outfit'; src: url('${fontsUrl}outfit-600.woff2') format('woff2'); font-weight: 600; font-display: swap; }
      @font-face { font-family: 'Literata'; src: url('${fontsUrl}literata-400.woff2') format('woff2'); font-weight: 400; font-style: normal; font-display: swap; }
      @font-face { font-family: 'Literata'; src: url('${fontsUrl}literata-400i.woff2') format('woff2'); font-weight: 400; font-style: italic; font-display: swap; }
      @font-face { font-family: 'Literata'; src: url('${fontsUrl}literata-500.woff2') format('woff2'); font-weight: 500; font-style: normal; font-display: swap; }
      @font-face { font-family: 'Sono'; src: url('${fontsUrl}sono-400.woff2') format('woff2'); font-weight: 400; font-display: swap; }
    `;
    document.head.appendChild(fontStyle);
  }

  const resolvedCss = cssText;

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

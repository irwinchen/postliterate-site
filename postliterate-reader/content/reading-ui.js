/**
 * Reading UI — creates the Shadow DOM overlay and manages the reading experience.
 *
 * This is the main entry point called by the content script after content extraction.
 */

import { parseBlocks } from './block-parser.js';
import { createReadingState } from './reading-state.js';
import { createProgressRingSVG, updateProgressRing } from './progress-ring.js';

/**
 * Create and mount the PostLiterate reading overlay.
 *
 * @param {Object} params
 * @param {string} params.title - Article title
 * @param {string} params.byline - Author/site info
 * @param {string} params.contentHtml - Article HTML from Readability
 * @param {string} params.cssText - CSS text for the shadow root
 * @param {Object} [params.settings] - User settings
 * @param {'light'|'dark'|'auto'} [params.settings.theme='auto']
 * @param {'deep-reader'|'original'} [params.settings.style='deep-reader']
 * @param {'normal'|'fast'|'instant'} [params.settings.speed='normal']
 * @param {number} [params.settings.startAt=1] - Resume position
 * @param {Object} [params.originalStyles] - Captured original page styles
 * @returns {{ destroy: () => void, getProgress: () => number }}
 */
export function createReadingOverlay({
  title,
  byline,
  contentHtml,
  cssText,
  settings = {},
  originalStyles = null,
}) {
  const {
    theme = 'auto',
    style = 'deep-reader',
    speed = 'normal',
    startAt = 1,
  } = settings;

  // Create host element
  const host = document.createElement('div');
  host.id = 'postliterate-reader';
  host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647;';

  // Apply theme
  const resolvedTheme = theme === 'auto'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;
  host.setAttribute('data-theme', resolvedTheme);

  // Apply style mode
  if (style === 'original') {
    host.setAttribute('data-style', 'original');
  }

  // Attach shadow root
  const shadow = host.attachShadow({ mode: 'open' });

  // Inject styles
  const styleEl = document.createElement('style');
  styleEl.textContent = cssText;
  shadow.appendChild(styleEl);

  // Apply original styles as custom properties if available
  if (originalStyles && style === 'original') {
    const props = [];
    for (const [key, value] of Object.entries(originalStyles)) {
      props.push(`--original-${key}: ${value}`);
    }
    host.style.cssText += props.join('; ') + ';';
  }

  // Build DOM structure
  const root = document.createElement('div');
  root.className = 'pl-reader-root';

  // — Toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'pl-toolbar';

  const titleEl = document.createElement('span');
  titleEl.className = 'pl-toolbar-title';
  titleEl.textContent = title || 'Reading';

  const styleBtn = document.createElement('button');
  styleBtn.className = 'pl-toolbar-style' + (style === 'deep-reader' ? ' active' : '');
  styleBtn.textContent = style === 'deep-reader' ? 'Deep Reader' : 'Original';
  styleBtn.title = 'Toggle reading style';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'pl-toolbar-btn';
  closeBtn.title = 'Close reader';
  closeBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>`;

  toolbar.append(titleEl, styleBtn, closeBtn);

  // — Content area
  const contentArea = document.createElement('div');
  contentArea.className = 'pl-content-area';

  // Article header
  const header = document.createElement('div');
  header.className = 'pl-article-header';
  const h1 = document.createElement('h1');
  h1.className = 'pl-article-title';
  h1.textContent = title || '';
  header.appendChild(h1);

  if (byline) {
    const bylineEl = document.createElement('div');
    bylineEl.className = 'pl-article-byline';
    bylineEl.textContent = byline;
    header.appendChild(bylineEl);
  }

  // Article content blocks
  const articleContent = document.createElement('div');
  articleContent.className = 'pl-article-content';

  const blocks = parseBlocks(contentHtml);
  for (const block of blocks) {
    articleContent.appendChild(block);
  }

  contentArea.append(header, articleContent);

  // — Advance button with progress ring
  const advanceBtn = document.createElement('button');
  advanceBtn.className = 'fr-advance';
  advanceBtn.setAttribute('aria-label', 'Show next section');
  const progressSVG = createProgressRingSVG();
  advanceBtn.appendChild(progressSVG);

  // — Fullscreen button
  const fullscreenBtn = document.createElement('button');
  fullscreenBtn.className = 'fr-fullscreen';
  fullscreenBtn.setAttribute('aria-label', 'Toggle fullscreen');
  fullscreenBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>`;

  root.append(toolbar, contentArea, advanceBtn, fullscreenBtn);
  shadow.appendChild(root);

  // Initialize reading state
  const state = createReadingState(blocks, {
    speed,
    startAt,
    onProgress: ({ progress, isComplete }) => {
      updateProgressRing(progressSVG, progress);
      if (isComplete) {
        advanceBtn.style.display = 'none';
      }
    },
    onComplete: () => {
      advanceBtn.style.display = 'none';
    },
  });

  // Update initial progress
  updateProgressRing(progressSVG, state.progress);
  if (state.isComplete) {
    advanceBtn.style.display = 'none';
  }

  // — Event handlers
  function handleAdvance() {
    state.advance();
    // Scroll the newly revealed block into view
    const idx = state.visibleCount - 1;
    if (idx >= 0 && idx < blocks.length) {
      blocks[idx].scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  advanceBtn.addEventListener('click', handleAdvance);

  function handleKeydown(e) {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;

    if (e.key === 'ArrowDown' || e.key === ' ' || e.key === 'j') {
      e.preventDefault();
      handleAdvance();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      destroy();
    }
  }

  document.addEventListener('keydown', handleKeydown);

  closeBtn.addEventListener('click', destroy);

  // Style toggle
  styleBtn.addEventListener('click', () => {
    const currentStyle = host.getAttribute('data-style');
    if (currentStyle === 'original') {
      host.removeAttribute('data-style');
      styleBtn.textContent = 'Deep Reader';
      styleBtn.classList.add('active');
    } else {
      host.setAttribute('data-style', 'original');
      styleBtn.textContent = 'Original';
      styleBtn.classList.remove('active');
    }
  });

  // Fullscreen toggle
  fullscreenBtn.addEventListener('click', () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      host.requestFullscreen();
    }
  });

  // Listen for system theme changes
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  function handleThemeChange(e) {
    if (theme === 'auto') {
      host.setAttribute('data-theme', e.matches ? 'dark' : 'light');
    }
  }
  mediaQuery.addEventListener('change', handleThemeChange);

  // Mount
  document.body.appendChild(host);

  // Prevent body scroll while reader is open
  const originalOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  // — Destroy function
  function destroy() {
    document.removeEventListener('keydown', handleKeydown);
    mediaQuery.removeEventListener('change', handleThemeChange);
    document.body.style.overflow = originalOverflow;
    if (document.fullscreenElement === host) {
      document.exitFullscreen();
    }
    host.remove();
  }

  return {
    destroy,
    getProgress: () => state.progress,
    getVisibleCount: () => state.visibleCount,
  };
}

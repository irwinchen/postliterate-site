/**
 * Reading UI — creates the Shadow DOM overlay and manages the reading experience.
 *
 * This is the main entry point called by the content script after content extraction.
 */

import { parseBlocks } from './block-parser.js';
import { createReadingState } from './reading-state.js';
import { createProgressRingSVG, updateProgressRing } from './progress-ring.js';

const GEAR_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`;
const CLOSE_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>`;
const FULLSCREEN_EXPAND = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>`;

/**
 * Build a toggle button group for settings.
 */
function createOptionGroup(label, options, currentValue, onChange) {
  const row = document.createElement('div');
  row.className = 'pl-settings-row';

  const labelEl = document.createElement('span');
  labelEl.className = 'pl-settings-label';
  labelEl.textContent = label;
  row.appendChild(labelEl);

  const group = document.createElement('div');
  group.className = 'pl-settings-group';

  for (const opt of options) {
    const btn = document.createElement('button');
    btn.className = 'pl-settings-option' + (opt.value === currentValue ? ' active' : '');
    btn.textContent = opt.label;
    btn.dataset.value = opt.value;
    btn.addEventListener('click', () => {
      group.querySelectorAll('.pl-settings-option').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      onChange(opt.value);
    });
    group.appendChild(btn);
  }

  row.appendChild(group);
  return row;
}

/**
 * Create and mount the PostLiterate reading overlay.
 */
export function createReadingOverlay({
  title,
  byline,
  contentHtml,
  cssText,
  settings = {},
  originalStyles = null,
}) {
  let {
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
  function resolveTheme(t) {
    return t === 'auto'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : t;
  }
  host.setAttribute('data-theme', resolveTheme(theme));

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

  // Always inject original styles as custom properties (so toggle works anytime)
  if (originalStyles) {
    const origStyleEl = document.createElement('style');
    const props = Object.entries(originalStyles)
      .map(([key, value]) => `--original-${key}: ${value}`)
      .join('; ');
    origStyleEl.textContent = `:host { ${props}; }`;
    shadow.appendChild(origStyleEl);
  }

  // Build DOM structure
  const root = document.createElement('div');
  root.className = 'pl-reader-root';
  root.style.colorScheme = resolveTheme(theme);

  // — Toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'pl-toolbar';

  const titleEl = document.createElement('span');
  titleEl.className = 'pl-toolbar-title';
  titleEl.textContent = title || 'Reading';

  // Gear button (settings)
  const gearBtn = document.createElement('button');
  gearBtn.className = 'pl-toolbar-btn';
  gearBtn.title = 'Settings';
  gearBtn.innerHTML = GEAR_ICON;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'pl-toolbar-btn';
  closeBtn.title = 'Close reader';
  closeBtn.innerHTML = CLOSE_ICON;

  toolbar.append(titleEl, gearBtn, closeBtn);

  // — Settings panel (hidden by default, absolute inside sticky toolbar)
  const settingsPanel = document.createElement('div');
  settingsPanel.className = 'pl-settings-panel';
  Object.assign(settingsPanel.style, {
    display: 'none',
    position: 'absolute',
    insetBlockStart: '100%',
    insetInlineEnd: '0',
    width: '260px',
    zIndex: '20',
  });
  toolbar.appendChild(settingsPanel);

  const styleGroup = createOptionGroup('Style', [
    { label: 'Deep Reader', value: 'deep-reader' },
    { label: 'Original', value: 'original' },
  ], style, (val) => {
    style = val;
    if (val === 'original') {
      host.setAttribute('data-style', 'original');
    } else {
      host.removeAttribute('data-style');
    }
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ style: val });
    }
  });

  const themeGroup = createOptionGroup('Theme', [
    { label: 'Auto', value: 'auto' },
    { label: 'Light', value: 'light' },
    { label: 'Dark', value: 'dark' },
  ], theme, (val) => {
    theme = val;
    const resolved = resolveTheme(val);
    host.setAttribute('data-theme', resolved);
    root.style.colorScheme = resolved;
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ theme: val });
    }
  });

  const speedGroup = createOptionGroup('Speed', [
    { label: 'Normal', value: 'normal' },
    { label: 'Fast', value: 'fast' },
    { label: 'Instant', value: 'instant' },
  ], speed, (val) => {
    speed = val;
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ speed: val });
    }
  });

  settingsPanel.append(styleGroup, themeGroup, speedGroup);

  // Toggle settings panel
  let settingsOpen = false;
  gearBtn.addEventListener('click', () => {
    settingsOpen = !settingsOpen;
    settingsPanel.style.display = settingsOpen ? 'flex' : 'none';
    gearBtn.classList.toggle('active', settingsOpen);
  });

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
  fullscreenBtn.innerHTML = FULLSCREEN_EXPAND;

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
      if (settingsOpen) {
        settingsOpen = false;
        settingsPanel.style.display = 'none';
        gearBtn.classList.remove('active');
      } else {
        destroy();
      }
    }
  }

  document.addEventListener('keydown', handleKeydown);

  closeBtn.addEventListener('click', destroy);

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

/**
 * Reading UI — creates the Shadow DOM overlay and manages the reading experience.
 *
 * This is the main entry point called by the content script after content extraction.
 */

import { parseBlocks } from './block-parser.js';
import { createReadingState } from './reading-state.js';
import { createProgressRingSVG, updateProgressRing } from './progress-ring.js';
import { createEditOverlay } from './edit-mode-ui.js';

const GEAR_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`;
const CLOSE_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>`;
const EDIT_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>`;
const FULLSCREEN_EXPAND = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>`;

/**
 * Build a toggle button group for settings (Mode, Theme, Speed).
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
 * Build a dropdown select for settings (fonts).
 */
function createSelectGroup(label, options, currentValue, onChange) {
  const row = document.createElement('div');
  row.className = 'pl-settings-row';

  const labelEl = document.createElement('span');
  labelEl.className = 'pl-settings-label';
  labelEl.textContent = label;
  row.appendChild(labelEl);

  const select = document.createElement('select');
  select.className = 'pl-settings-select';

  for (const opt of options) {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    if (opt.value === currentValue) option.selected = true;
    select.appendChild(option);
  }

  select.addEventListener('change', () => {
    onChange(select.value);
  });

  row.appendChild(select);
  return row;
}

/**
 * Create and mount the PostLiterate reading overlay.
 */
export function createReadingOverlay({
  title,
  byline,
  siteName = '',
  faviconUrl = '',
  publishDate = '',
  contentHtml,
  cssText,
  settings = {},
  originalStyles = null,
  selectedIds = null,
}) {
  let {
    theme = 'auto',
    speed = 'medium',
    fontBody = 'original',
    fontHeading = 'original',
    fontCode = 'original',
    readingMode = 'deep',
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

  // Attach shadow root
  const shadow = host.attachShadow({ mode: 'open' });

  // Inject styles
  const styleEl = document.createElement('style');
  styleEl.textContent = cssText;
  shadow.appendChild(styleEl);

  // Inject original page styles as custom properties
  if (originalStyles) {
    const origStyleEl = document.createElement('style');
    const props = Object.entries(originalStyles)
      .map(([key, value]) => `--original-${key}: ${value}`)
      .join('; ');
    origStyleEl.textContent = `:host { ${props}; }`;
    shadow.appendChild(origStyleEl);
  }

  // Font override custom properties (applied when user selects non-"original" fonts)
  const FONT_MAP = {
    body: {
      original: null,
      literata: "'Literata', serif",
      'system-sans': "system-ui, -apple-system, sans-serif",
      'system-serif': "Georgia, 'Times New Roman', serif",
    },
    heading: {
      original: null,
      outfit: "'Outfit', sans-serif",
      'system-sans': "system-ui, -apple-system, sans-serif",
      'system-serif': "Georgia, 'Times New Roman', serif",
    },
    code: {
      original: null,
      sono: "'Sono', monospace",
      'system-mono': "ui-monospace, 'Cascadia Code', 'Fira Code', monospace",
    },
  };

  const fontOverrideEl = document.createElement('style');
  shadow.appendChild(fontOverrideEl);

  function applyFontOverrides() {
    const overrides = [];
    const bodyVal = FONT_MAP.body[fontBody];
    const headingVal = FONT_MAP.heading[fontHeading];
    const codeVal = FONT_MAP.code[fontCode];
    if (bodyVal) overrides.push(`--font-body-override: ${bodyVal}`);
    if (headingVal) overrides.push(`--font-heading-override: ${headingVal}`);
    if (codeVal) overrides.push(`--font-code-override: ${codeVal}`);
    fontOverrideEl.textContent = overrides.length
      ? `:host { ${overrides.join('; ')}; }`
      : '';
  }
  applyFontOverrides();

  // Build DOM structure
  const root = document.createElement('div');
  root.className = 'pl-reader-root';
  root.style.colorScheme = resolveTheme(theme);

  // — Toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'pl-toolbar';

  // Favicon in toolbar
  if (faviconUrl) {
    const toolbarFavicon = document.createElement('img');
    toolbarFavicon.className = 'pl-toolbar-favicon';
    toolbarFavicon.src = faviconUrl;
    toolbarFavicon.alt = '';
    toolbarFavicon.width = 16;
    toolbarFavicon.height = 16;
    toolbarFavicon.onerror = () => { toolbarFavicon.style.display = 'none'; };
    toolbar.appendChild(toolbarFavicon);
  }

  const titleEl = document.createElement('span');
  titleEl.className = 'pl-toolbar-title';
  titleEl.textContent = title || 'Reading';

  // Edit button (refine extraction)
  const editBtn = document.createElement('button');
  editBtn.className = 'pl-toolbar-btn';
  editBtn.title = 'Edit selection';
  editBtn.innerHTML = EDIT_ICON;
  // Only show if we have selectedIds for mapping back to originals
  if (!selectedIds || selectedIds.size === 0) {
    editBtn.style.display = 'none';
  }

  // Gear button (settings)
  const gearBtn = document.createElement('button');
  gearBtn.className = 'pl-toolbar-btn';
  gearBtn.title = 'Settings';
  gearBtn.innerHTML = GEAR_ICON;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'pl-toolbar-btn';
  closeBtn.title = 'Close reader';
  closeBtn.innerHTML = CLOSE_ICON;

  toolbar.append(titleEl, editBtn, gearBtn, closeBtn);

  // — Settings panel (hidden by default, absolute inside sticky toolbar)
  const settingsPanel = document.createElement('div');
  settingsPanel.className = 'pl-settings-panel';
  Object.assign(settingsPanel.style, {
    display: 'none',
    position: 'absolute',
    insetBlockStart: '100%',
    insetInlineEnd: '24px',
    width: '260px',
    maxWidth: 'calc(100vw - 48px)',
    zIndex: '20',
  });
  toolbar.appendChild(settingsPanel);

  const fontBodyGroup = createSelectGroup('Body', [
    { label: 'Original', value: 'original' },
    { label: 'Literata', value: 'literata' },
    { label: 'System Sans', value: 'system-sans' },
    { label: 'System Serif', value: 'system-serif' },
  ], fontBody, (val) => {
    fontBody = val;
    applyFontOverrides();
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ fontBody: val });
    }
  });

  const fontHeadingGroup = createSelectGroup('Heading', [
    { label: 'Original', value: 'original' },
    { label: 'Outfit', value: 'outfit' },
    { label: 'System Sans', value: 'system-sans' },
    { label: 'System Serif', value: 'system-serif' },
  ], fontHeading, (val) => {
    fontHeading = val;
    applyFontOverrides();
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ fontHeading: val });
    }
  });

  const fontCodeGroup = createSelectGroup('Code', [
    { label: 'Original', value: 'original' },
    { label: 'Sono', value: 'sono' },
    { label: 'System Mono', value: 'system-mono' },
  ], fontCode, (val) => {
    fontCode = val;
    applyFontOverrides();
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ fontCode: val });
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
    { label: 'Slow', value: 'slow' },
    { label: 'Medium', value: 'medium' },
    { label: 'Fast', value: 'fast' },
    { label: 'Instant', value: 'instant' },
  ], speed, (val) => {
    speed = val;
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ speed: val });
    }
  });

  const modeGroup = createOptionGroup('Mode', [
    { label: 'Deep Reading', value: 'deep' },
    { label: 'Browse', value: 'browse' },
  ], readingMode, (val) => {
    readingMode = val;
    applyReadingMode();
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ readingMode: val });
    }
  });

  settingsPanel.append(modeGroup, fontBodyGroup, fontHeadingGroup, fontCodeGroup, themeGroup, speedGroup);

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

  // Publication info row: favicon + site name + date
  if (siteName || faviconUrl || publishDate) {
    const pubRow = document.createElement('div');
    pubRow.className = 'pl-article-pub';

    if (faviconUrl) {
      const favicon = document.createElement('img');
      favicon.className = 'pl-article-favicon';
      favicon.src = faviconUrl;
      favicon.alt = '';
      favicon.width = 16;
      favicon.height = 16;
      // Hide broken favicons gracefully
      favicon.onerror = () => { favicon.style.display = 'none'; };
      pubRow.appendChild(favicon);
    }

    if (siteName) {
      const siteEl = document.createElement('span');
      siteEl.className = 'pl-article-site';
      siteEl.textContent = siteName;
      pubRow.appendChild(siteEl);
    }

    if (publishDate) {
      if (siteName) {
        const sep = document.createElement('span');
        sep.className = 'pl-article-sep';
        sep.textContent = '\u00B7';
        pubRow.appendChild(sep);
      }
      const dateEl = document.createElement('span');
      dateEl.className = 'pl-article-date';
      dateEl.textContent = publishDate;
      pubRow.appendChild(dateEl);
    }

    header.appendChild(pubRow);
  }

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

  let blocks = parseBlocks(contentHtml);
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
  let state = createReadingState(blocks, {
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

  // — Reading mode toggle (Deep Reading vs Browse)
  function applyReadingMode() {
    if (readingMode === 'browse') {
      // Show all blocks, hide advance button
      for (const block of blocks) {
        block.classList.remove('fr-hidden', 'fr-visible', 'fr-revealing');
        block.style.clipPath = '';
        block.style.opacity = '';
        block.style.transition = '';
      }
      advanceBtn.style.display = 'none';
    } else {
      // Re-enter deep reading from current position
      state = createReadingState(blocks, {
        speed,
        startAt: state.visibleCount || 1,
        onProgress: ({ progress, isComplete }) => {
          updateProgressRing(progressSVG, progress);
          if (isComplete) advanceBtn.style.display = 'none';
        },
        onComplete: () => { advanceBtn.style.display = 'none'; },
      });
      advanceBtn.style.display = '';
      updateProgressRing(progressSVG, state.progress);
    }
  }
  applyReadingMode();

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

  // — Edit mode: enter/exit
  let editOverlay = null;

  // Defined at outer scope so exitEditMode can remove it
  function blockNavigation(e) {
    if (e.target.closest('a[href]')) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  editBtn.addEventListener('click', () => {
    if (!selectedIds || selectedIds.size === 0) return;

    // Hide the reading overlay
    host.style.display = 'none';
    document.body.style.overflow = '';

    // Disable all links to prevent accidental navigation
    document.addEventListener('click', blockNavigation, true);

    // Inject edit mode CSS into the page (not shadow DOM)
    let editStyleEl = document.getElementById('pl-edit-styles');
    if (!editStyleEl) {
      editStyleEl = document.createElement('style');
      editStyleEl.id = 'pl-edit-styles';
      editStyleEl.textContent = `
        a[href] {
          pointer-events: none !important;
          cursor: default !important;
        }
        .pl-edit-selected {
          outline: 2px solid #E53E33 !important;
          outline-offset: 2px !important;
          position: relative !important;
          z-index: 2147483641 !important;
        }
        .pl-edit-hover-controls {
          position: absolute;
          inset-block-start: 2px;
          inset-inline-end: 2px;
          display: flex;
          gap: 4px;
          z-index: 2147483645;
          pointer-events: auto;
        }
        .pl-edit-hover-controls button {
          width: 28px;
          height: 28px;
          border: 1px solid #666;
          background: #1a1a1a;
          color: #fff;
          font-size: 16px;
          line-height: 1;
          cursor: pointer;
          display: grid;
          place-items: center;
          padding: 0;
        }
        .pl-edit-hover-controls button:hover {
          background: #E53E33;
          border-color: #E53E33;
        }
      `;
      document.head.appendChild(editStyleEl);
    }

    // Create the edit overlay
    editOverlay = createEditOverlay({
      page: document.body,
      selectedIds,
      onConfirm: (assembledElements, currentMode) => {
        // Update selectedIds so next edit session preserves removals/additions
        selectedIds = currentMode.getSelectedIds();

        // Wrap assembled elements in a container and run through parseBlocks
        // for consistent filtering, visibility states, etc.
        const tempContainer = document.createElement('div');
        for (const el of assembledElements) {
          tempContainer.appendChild(el);
        }
        const newBlocks = parseBlocks(tempContainer.innerHTML);

        // Replace reading content
        articleContent.innerHTML = '';
        for (const block of newBlocks) {
          articleContent.appendChild(block);
        }

        // Reassign blocks so handleAdvance uses the new array
        blocks = newBlocks;

        // Re-apply the user's current reading mode (browse or deep)
        applyReadingMode();

        // Exit edit mode, show reader
        exitEditMode();
      },
      onCancel: () => {
        exitEditMode();
      },
    });

    // Set up hover controls on tagged elements
    setupHoverControls(editOverlay);
  });

  function exitEditMode() {
    if (editOverlay) {
      editOverlay.destroy();
      editOverlay = null;
    }
    document.removeEventListener('click', blockNavigation, true);
    const editStyleEl = document.getElementById('pl-edit-styles');
    if (editStyleEl) editStyleEl.remove();
    host.style.display = '';
    document.body.style.overflow = 'hidden';
  }

  /**
   * Set up mouseover/mouseout handlers for hover controls on tagged elements.
   */
  function setupHoverControls(overlay) {
    let currentControls = null;
    let currentTarget = null;

    function removeControls() {
      if (currentControls) {
        currentControls.remove();
        currentControls = null;
        currentTarget = null;
      }
    }

    function createControls(el) {
      removeControls();
      const controls = document.createElement('div');
      controls.className = 'pl-edit-hover-controls';

      if (overlay.mode.isSelected(el)) {
        // Selected: pencil + X
        const pencilBtn = document.createElement('button');
        pencilBtn.textContent = '\u270F';
        pencilBtn.title = 'Reclassify';
        pencilBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          showTagPicker(el, overlay, controls);
        });

        const removeBtn = document.createElement('button');
        removeBtn.textContent = '\u2715';
        removeBtn.title = 'Remove';
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          overlay.removeElement(el);
          removeControls();
        });

        controls.append(pencilBtn, removeBtn);
      } else {
        // Unselected: + button
        const addBtn = document.createElement('button');
        addBtn.textContent = '+';
        addBtn.title = 'Add';
        addBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          overlay.addElement(el);
          removeControls();
        });

        controls.appendChild(addBtn);
      }

      el.style.position = el.style.position || 'relative';
      el.appendChild(controls);
      currentControls = controls;
      currentTarget = el;
    }

    document.body.addEventListener('mouseover', (e) => {
      const el = e.target.closest('[data-pl-id]');
      if (!el || el === currentTarget) return;
      // Don't attach to the edit toolbar or scrim
      if (el.closest('.pl-edit-toolbar, .pl-edit-scrim')) return;
      createControls(el);
    });

    document.body.addEventListener('mouseout', (e) => {
      const el = e.target.closest('[data-pl-id]');
      if (!el) return;
      // Check if we're moving to a child (don't remove controls)
      if (el.contains(e.relatedTarget)) return;
      if (el === currentTarget) {
        removeControls();
      }
    });
  }

  /**
   * Show a tag picker dropdown for reclassifying an element.
   */
  function showTagPicker(el, overlay, controlsContainer) {
    const existing = controlsContainer.querySelector('.pl-tag-picker');
    if (existing) { existing.remove(); return; }

    const picker = document.createElement('div');
    picker.className = 'pl-tag-picker';
    Object.assign(picker.style, {
      position: 'absolute',
      insetBlockStart: '100%',
      insetInlineEnd: '0',
      display: 'flex',
      flexDirection: 'column',
      background: '#1a1a1a',
      border: '1px solid #666',
      zIndex: '2147483646',
      minWidth: '120px',
    });

    const tags = ['P', 'H2', 'H3', 'BLOCKQUOTE', 'FIGURE', 'PRE', 'UL', 'OL'];
    for (const tag of tags) {
      const btn = document.createElement('button');
      btn.textContent = tag;
      Object.assign(btn.style, {
        padding: '4px 12px',
        background: 'transparent',
        color: '#fff',
        border: 'none',
        borderBlockEnd: '1px solid #333',
        fontFamily: 'Outfit, system-ui, sans-serif',
        fontSize: '12px',
        cursor: 'pointer',
        textAlign: 'start',
      });
      btn.addEventListener('mouseover', () => { btn.style.background = '#333'; });
      btn.addEventListener('mouseout', () => { btn.style.background = 'transparent'; });
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        overlay.mode.reclassify(el, tag);
        picker.remove();
      });
      picker.appendChild(btn);
    }

    controlsContainer.appendChild(picker);
  }

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

  // — Public method to programmatically enter edit mode
  function enterEditMode() {
    editBtn.click();
  }

  return {
    destroy,
    enterEditMode,
    getProgress: () => state.progress,
    getVisibleCount: () => state.visibleCount,
  };
}

/**
 * Popup script — handles settings UI and Start Reading button.
 */

const DEFAULTS = {
  theme: 'auto',
  speed: 'medium',
  fontBody: 'original',
  fontHeading: 'original',
  fontCode: 'original',
};

// Current settings (loaded from storage)
let settings = { ...DEFAULTS };

/**
 * Set up toggle button groups.
 * Each group has data-value buttons; clicking one activates it and deactivates siblings.
 */
function initOptionGroup(containerId, settingKey) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const buttons = container.querySelectorAll('.setting-btn');

  // Set initial active state from settings
  buttons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.value === settings[settingKey]);
  });

  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.setting-btn');
    if (!btn) return;

    buttons.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');

    settings[settingKey] = btn.dataset.value;
    chrome.storage.local.set({ [settingKey]: btn.dataset.value });
  });
}

/**
 * Start reading on the active tab.
 */
async function startReading() {
  const btn = document.getElementById('start-reading');
  btn.textContent = 'Loading...';
  btn.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'toggle-reader-from-popup',
      settings,
    });

    if (response && response.success) {
      window.close(); // Close popup after successful activation
    } else if (response && response.reason === 'extraction-failed') {
      btn.textContent = 'Could not extract content';
      setTimeout(() => {
        btn.textContent = 'Start Reading';
        btn.disabled = false;
      }, 2000);
    } else if (response && response.reason === 'toggled-off') {
      window.close();
    } else {
      btn.textContent = 'Start Reading';
      btn.disabled = false;
    }
  } catch (error) {
    console.error('Failed to start reading:', error);
    btn.textContent = 'Error — try again';
    setTimeout(() => {
      btn.textContent = 'Start Reading';
      btn.disabled = false;
    }, 2000);
  }
}

/**
 * Edit extraction before reading — goes straight to edit mode.
 */
async function editFirst() {
  const btn = document.getElementById('edit-first');
  btn.textContent = 'Loading...';
  btn.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'edit-first-from-popup',
      settings,
    });

    if (response && response.success) {
      window.close();
    } else if (response && response.reason === 'extraction-failed') {
      btn.textContent = 'Could not extract content';
      setTimeout(() => {
        btn.textContent = 'Edit First';
        btn.disabled = false;
      }, 2000);
    } else {
      btn.textContent = 'Edit First';
      btn.disabled = false;
    }
  } catch (error) {
    console.error('Failed to start edit mode:', error);
    btn.textContent = 'Error — try again';
    setTimeout(() => {
      btn.textContent = 'Edit First';
      btn.disabled = false;
    }, 2000);
  }
}

/**
 * Initialize popup.
 */
async function init() {
  // Load saved settings
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  settings = { ...DEFAULTS, ...stored };

  // Initialize option groups
  initOptionGroup('theme-options', 'theme');
  initOptionGroup('speed-options', 'speed');

  // Start Reading button
  document.getElementById('start-reading').addEventListener('click', startReading);

  // Edit First button
  document.getElementById('edit-first').addEventListener('click', editFirst);

  // Library button
  document.getElementById('open-library').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('library/library.html') });
    window.close();
  });

  // Insights button
  document.getElementById('open-insights').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('insights/insights.html') });
    window.close();
  });
}

init();

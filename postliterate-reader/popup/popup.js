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
    } else if (response && response.reason === 'no-api-key') {
      btn.textContent = 'Set Reducto API key below';
      setTimeout(() => {
        btn.textContent = 'Start Reading';
        btn.disabled = false;
      }, 2000);
      // Open the PDF section
      document.getElementById('pdf-toggle').classList.add('open');
      document.getElementById('pdf-body').style.display = 'flex';
    } else if (response && response.reason === 'extraction-failed') {
      btn.textContent = 'Not a longform article';
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
      btn.textContent = 'Not a longform article';
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

  // PDF section toggle
  const pdfToggle = document.getElementById('pdf-toggle');
  const pdfBody = document.getElementById('pdf-body');
  pdfToggle.addEventListener('click', () => {
    const isOpen = pdfBody.style.display !== 'none';
    pdfBody.style.display = isOpen ? 'none' : 'flex';
    pdfToggle.classList.toggle('open', !isOpen);
  });

  // Reducto API key
  const keyInput = document.getElementById('reducto-key');
  const { reductoApiKey } = await chrome.storage.local.get('reductoApiKey');
  if (reductoApiKey) keyInput.value = reductoApiKey;
  let keyTimer;
  keyInput.addEventListener('input', () => {
    clearTimeout(keyTimer);
    keyTimer = setTimeout(() => {
      chrome.storage.local.set({ reductoApiKey: keyInput.value.trim() });
    }, 500);
  });

  // PDF import from popup (port-based with progress)
  const importBtn = document.getElementById('import-pdf-popup');
  const fileInput = document.getElementById('pdf-file-popup');
  const cancelPdfBtn = document.getElementById('cancel-pdf-popup');
  const pdfProgressEl = document.getElementById('pdf-progress-popup');
  const pdfStatusEl = document.getElementById('pdf-status-popup');
  const pdfFillEl = document.getElementById('pdf-fill-popup');
  let pdfPort = null;

  function resetPdfUI() {
    importBtn.textContent = 'Import PDF';
    importBtn.disabled = false;
    cancelPdfBtn.style.display = 'none';
    pdfProgressEl.style.display = 'none';
    pdfFillEl.style.width = '0%';
    fileInput.value = '';
    pdfPort = null;
  }

  importBtn.addEventListener('click', () => fileInput.click());

  cancelPdfBtn.addEventListener('click', () => {
    if (pdfPort) pdfPort.disconnect();
    resetPdfUI();
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;

    importBtn.disabled = true;
    importBtn.textContent = 'Processing...';
    cancelPdfBtn.style.display = 'inline';
    pdfProgressEl.style.display = 'flex';
    pdfStatusEl.textContent = 'Reading file...';
    pdfFillEl.style.width = '0%';

    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);

    const port = chrome.runtime.connect({ name: 'pdf-import' });
    pdfPort = port;

    port.onMessage.addListener((msg) => {
      if (msg.progress != null) pdfFillEl.style.width = `${Math.round(msg.progress * 100)}%`;
      if (msg.status) pdfStatusEl.textContent = msg.status;
      if (msg.done && msg.entry) {
        chrome.tabs.create({ url: chrome.runtime.getURL(`viewer/viewer.html?id=${msg.entry.id}`) });
        window.close();
      }
      if (msg.error) {
        pdfStatusEl.textContent = msg.reason === 'no-api-key'
          ? 'Set your API key above'
          : msg.error;
        pdfFillEl.style.width = '0%';
        setTimeout(resetPdfUI, 3000);
      }
    });

    port.onDisconnect.addListener(() => {
      if (pdfPort === port) resetPdfUI();
    });

    port.postMessage({ base64, filename: file.name });
  });
}

init();

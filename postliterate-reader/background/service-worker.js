/**
 * Service worker — Manifest V3 background script.
 *
 * Handles:
 * - Keyboard shortcut (Alt+R) to toggle reader
 * - Messages from popup to inject content scripts
 * - Badge state management
 */

// Track which tabs have the reader active
const activeTabs = new Set();

/**
 * Inject scripts and toggle the reader in the given tab.
 */
async function toggleReader(tabId, settings = {}) {
  try {
    // Check if content script is already injected by trying to send a ping
    let alreadyInjected = false;
    try {
      const status = await chrome.tabs.sendMessage(tabId, { action: 'get-status' });
      alreadyInjected = true;
    } catch {
      // No listener = not yet injected
    }

    if (!alreadyInjected) {
      // Inject Readability.js first (IIFE, sets window.ReadabilityLib)
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['lib/readability.js'],
      });

      // Then inject the bundled content script (IIFE, sets up message listener)
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content/content-script.js'],
      });
    }

    // Send toggle message
    const response = await chrome.tabs.sendMessage(tabId, {
      action: 'toggle-reader',
      settings,
    });

    if (response && response.success) {
      activeTabs.add(tabId);
      chrome.action.setBadgeText({ text: 'ON', tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#E53E33', tabId });
    } else if (response && response.reason === 'toggled-off') {
      activeTabs.delete(tabId);
      chrome.action.setBadgeText({ text: '', tabId });
    } else if (response && response.reason === 'extraction-failed') {
      // Could trigger Manual Mode here in Phase 2
      console.warn('Extraction failed:', response.message);
    }

    return response;
  } catch (error) {
    console.error('Failed to toggle reader:', error);
    return { success: false, reason: 'injection-error', message: error.message };
  }
}

// Handle keyboard shortcut (Alt+R)
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-reader') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      const settings = await chrome.storage.local.get(['theme', 'style', 'speed']);
      await toggleReader(tab.id, settings);
    }
  }
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'toggle-reader-from-popup') {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        const response = await toggleReader(tab.id, message.settings || {});
        sendResponse(response);
      } else {
        sendResponse({ success: false, reason: 'no-active-tab' });
      }
    })();
    return true; // async response
  }
});

// Clean up badge when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  activeTabs.delete(tabId);
});

// Clean up badge when tab navigates
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' && activeTabs.has(tabId)) {
    activeTabs.delete(tabId);
    chrome.action.setBadgeText({ text: '', tabId });
  }
});

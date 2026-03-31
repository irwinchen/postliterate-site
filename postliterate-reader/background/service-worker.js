/**
 * Service worker — Manifest V3 background script.
 *
 * Handles:
 * - Keyboard shortcut (Alt+R) to toggle reader
 * - Messages from popup to inject content scripts
 * - Badge state management
 * - Library CRUD (save/get/delete/update articles)
 */

// ─── Library Storage ────────────────────────────────────────────────────────
// Hybrid: chrome.storage.local for index, IndexedDB for article content.

const DB_NAME = 'postliterate-library';
const DB_VERSION = 2;
const STORE_NAME = 'articles';
const SESSIONS_STORE = 'reading-sessions';
const INDEX_KEY = 'libraryIndex';

function _generateId() {
  const arr = new Uint8Array(4);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

function _openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        const sessionsStore = db.createObjectStore(SESSIONS_STORE, { keyPath: 'id' });
        sessionsStore.createIndex('articleUrl', 'articleUrl', { unique: false });
        sessionsStore.createIndex('startedAt', 'startedAt', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function _idbTx(mode, fn) {
  const db = await _openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

function _getIndex() {
  return new Promise((resolve) => {
    chrome.storage.local.get(INDEX_KEY, (r) => resolve(r[INDEX_KEY] || []));
  });
}

function _saveIndex(index) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [INDEX_KEY]: index }, resolve);
  });
}

async function librarySave(article) {
  const id = _generateId();
  const entry = {
    id,
    url: article.url,
    title: article.title,
    byline: article.byline || '',
    siteName: article.siteName || '',
    faviconUrl: article.faviconUrl || '',
    publishDate: article.publishDate || '',
    savedAt: Date.now(),
    wordCount: article.wordCount || 0,
    blockCount: article.blockCount || 0,
  };
  await _idbTx('readwrite', (s) =>
    s.put({ id, contentHtml: article.contentHtml, originalStyles: article.originalStyles || {} })
  );
  const index = await _getIndex();
  index.unshift(entry);
  await _saveIndex(index);
  return entry;
}

async function libraryGet(id) {
  const content = await _idbTx('readonly', (s) => s.get(id));
  if (!content) return null;
  const index = await _getIndex();
  const entry = index.find((e) => e.id === id);
  return entry ? { ...entry, ...content } : content;
}

async function libraryDelete(id) {
  await _idbTx('readwrite', (s) => s.delete(id));
  const index = await _getIndex();
  await _saveIndex(index.filter((e) => e.id !== id));
}

async function libraryUpdate(id, contentHtml, counts = {}) {
  const existing = await _idbTx('readonly', (s) => s.get(id));
  if (!existing) throw new Error(`Article ${id} not found`);
  await _idbTx('readwrite', (s) => s.put({ ...existing, contentHtml }));
  if (counts.wordCount != null || counts.blockCount != null) {
    const index = await _getIndex();
    const entry = index.find((e) => e.id === id);
    if (entry) {
      if (counts.wordCount != null) entry.wordCount = counts.wordCount;
      if (counts.blockCount != null) entry.blockCount = counts.blockCount;
      await _saveIndex(index);
    }
  }
}

async function libraryCheckUrl(url) {
  const index = await _getIndex();
  return index.find((e) => e.url === url) || null;
}

// ─── Reading Sessions ──────────────────────────────────────────────────────

async function _sessionsTx(mode, fn) {
  const db = await _openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSIONS_STORE, mode);
    const store = tx.objectStore(SESSIONS_STORE);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function saveSession(session) {
  session.id = session.id || _generateId();
  await _sessionsTx('readwrite', (s) => s.put(session));

  // Update article aggregate on library index
  const index = await _getIndex();
  const entry = index.find((e) => e.url === session.articleUrl);
  if (entry) {
    const duration = (session.endedAt || 0) - (session.startedAt || 0);
    entry.totalReadTimeMs = (entry.totalReadTimeMs || 0) + Math.max(0, duration);
    entry.sessionCount = (entry.sessionCount || 0) + 1;
    entry.lastReadAt = session.endedAt || Date.now();
    if (session.endBlock > (entry.highestBlock || 0)) {
      entry.highestBlock = session.endBlock;
    }
    if (session.totalBlocks > 0) {
      entry.readingDepth = (entry.highestBlock || 0) / session.totalBlocks;
    }
    if (session.completed && !entry.completed) {
      entry.completed = true;
      entry.completedAt = session.endedAt || Date.now();
    }
    await _saveIndex(index);
  }

  return session;
}

async function getSessions(opts = {}) {
  const db = await _openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSIONS_STORE, 'readonly');
    const store = tx.objectStore(SESSIONS_STORE);
    const results = [];
    const req = store.index('startedAt').openCursor(null, 'prev');
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) { resolve(results); return; }
      const val = cursor.value;
      if (opts.after && val.startedAt < opts.after) { resolve(results); return; }
      if (!opts.before || val.startedAt <= opts.before) {
        results.push(val);
      }
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function getReadingStats() {
  const index = await _getIndex();
  const sessions = await getSessions();

  const articlesWithSessions = index.filter((e) => (e.sessionCount || 0) > 0);
  const completedArticles = index.filter((e) => e.completed);
  const totalReadTimeMs = index.reduce((sum, e) => sum + (e.totalReadTimeMs || 0), 0);
  const avgDepth = articlesWithSessions.length > 0
    ? articlesWithSessions.reduce((sum, e) => sum + (e.readingDepth || 0), 0) / articlesWithSessions.length
    : 0;

  // Session duration stats
  const durations = sessions.map((s) => Math.max(0, (s.endedAt || 0) - (s.startedAt || 0)));
  const avgSessionMs = durations.length > 0
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : 0;

  // Reading days (for streak / heatmap)
  const dayMap = {};
  for (const s of sessions) {
    const day = new Date(s.startedAt).toISOString().slice(0, 10);
    const dur = Math.max(0, (s.endedAt || 0) - (s.startedAt || 0));
    dayMap[day] = (dayMap[day] || 0) + dur;
  }

  // Source/publisher breakdown
  const sourceMap = {};
  for (const e of index) {
    const source = e.siteName || new URL(e.url || 'https://unknown').hostname;
    if (!source) continue;
    if (!sourceMap[source]) {
      sourceMap[source] = { articles: 0, readTimeMs: 0, completed: 0 };
    }
    sourceMap[source].articles++;
    sourceMap[source].readTimeMs += e.totalReadTimeMs || 0;
    if (e.completed) sourceMap[source].completed++;
  }
  const topSources = Object.entries(sourceMap)
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.articles - a.articles)
    .slice(0, 10);

  return {
    totalArticles: index.length,
    articlesRead: articlesWithSessions.length,
    articlesCompleted: completedArticles.length,
    completionRate: articlesWithSessions.length > 0
      ? completedArticles.length / articlesWithSessions.length
      : 0,
    totalReadTimeMs,
    avgSessionMs,
    avgDepth,
    sessionCount: sessions.length,
    sessions,
    dayMap,
    topSources,
    recentlyCompleted: completedArticles
      .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))
      .slice(0, 5),
  };
}

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
      const settings = await chrome.storage.local.get(['theme', 'style', 'speed', 'readingMode', 'fontBody', 'fontHeading', 'fontCode']);
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
    return true;
  }

  // ─── Library CRUD messages ──────────────────────────────────────────
  if (message.action === 'save-article') {
    librarySave(message.data).then(
      (entry) => sendResponse({ success: true, entry }),
      (err) => sendResponse({ success: false, error: err.message })
    );
    return true;
  }

  if (message.action === 'get-library-index') {
    _getIndex().then(
      (index) => sendResponse({ success: true, index }),
      (err) => sendResponse({ success: false, error: err.message })
    );
    return true;
  }

  if (message.action === 'get-article') {
    libraryGet(message.id).then(
      (article) => sendResponse({ success: true, article }),
      (err) => sendResponse({ success: false, error: err.message })
    );
    return true;
  }

  if (message.action === 'delete-article') {
    libraryDelete(message.id).then(
      () => sendResponse({ success: true }),
      (err) => sendResponse({ success: false, error: err.message })
    );
    return true;
  }

  if (message.action === 'update-article') {
    libraryUpdate(message.id, message.contentHtml, message.counts).then(
      () => sendResponse({ success: true }),
      (err) => sendResponse({ success: false, error: err.message })
    );
    return true;
  }

  if (message.action === 'check-saved') {
    libraryCheckUrl(message.url).then(
      (entry) => sendResponse({ success: true, entry }),
      (err) => sendResponse({ success: false, error: err.message })
    );
    return true;
  }

  // ─── Reading session messages ──────────────────────────────────────
  if (message.action === 'save-session') {
    saveSession(message.session).then(
      (session) => sendResponse({ success: true, session }),
      (err) => sendResponse({ success: false, error: err.message })
    );
    return true;
  }

  if (message.action === 'get-sessions') {
    getSessions(message.opts || {}).then(
      (sessions) => sendResponse({ success: true, sessions }),
      (err) => sendResponse({ success: false, error: err.message })
    );
    return true;
  }

  if (message.action === 'get-reading-stats') {
    getReadingStats().then(
      (stats) => sendResponse({ success: true, stats }),
      (err) => sendResponse({ success: false, error: err.message })
    );
    return true;
  }

  if (message.action === 'edit-first-from-popup') {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        const response = await toggleReader(tab.id, {
          ...(message.settings || {}),
          editFirst: true,
        });
        sendResponse(response);
      } else {
        sendResponse({ success: false, reason: 'no-active-tab' });
      }
    })();
    return true;
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

/**
 * Library storage — hybrid chrome.storage.local (index) + IndexedDB (content).
 *
 * The lightweight index (~200 bytes/article) stays in chrome.storage.local
 * for fast access. Heavy content (50-200KB/article) goes in IndexedDB.
 */

const DB_NAME = 'postliterate-library';
const DB_VERSION = 1;
const STORE_NAME = 'articles';
const INDEX_KEY = 'libraryIndex';

/**
 * Generate an 8-character random hex ID.
 */
function generateId() {
  const arr = new Uint8Array(4);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Open (or create) the IndexedDB database.
 * @returns {Promise<IDBDatabase>}
 */
function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Run a single IndexedDB transaction.
 * @param {'readonly'|'readwrite'} mode
 * @param {(store: IDBObjectStore) => IDBRequest} fn
 * @returns {Promise<any>}
 */
async function idbTransaction(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const request = fn(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

/**
 * Get the library index from chrome.storage.local.
 * @returns {Promise<Array>}
 */
export async function getLibraryIndex() {
  return new Promise((resolve) => {
    chrome.storage.local.get(INDEX_KEY, (result) => {
      resolve(result[INDEX_KEY] || []);
    });
  });
}

/**
 * Save the library index to chrome.storage.local.
 * @param {Array} index
 * @returns {Promise<void>}
 */
function saveIndex(index) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [INDEX_KEY]: index }, resolve);
  });
}

/**
 * Save an article to the library.
 *
 * The caller (content script) should pre-compute wordCount and blockCount
 * since the service worker has no DOM access.
 *
 * @param {Object} article
 * @param {string} article.url
 * @param {string} article.title
 * @param {string} [article.byline]
 * @param {string} [article.siteName]
 * @param {string} [article.faviconUrl]
 * @param {string} [article.publishDate]
 * @param {number} [article.wordCount]
 * @param {number} [article.blockCount]
 * @param {string} article.contentHtml - The assembled reading content
 * @param {Object} [article.originalStyles] - Captured page font/color custom properties
 * @returns {Promise<Object>} The saved index entry (includes generated id)
 */
export async function saveArticle(article) {
  const id = generateId();

  // Index entry (lightweight metadata)
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

  // Store content in IndexedDB
  await idbTransaction('readwrite', (store) =>
    store.put({
      id,
      contentHtml: article.contentHtml,
      originalStyles: article.originalStyles || {},
    })
  );

  // Update index
  const index = await getLibraryIndex();
  index.unshift(entry); // newest first
  await saveIndex(index);

  return entry;
}

/**
 * Get full article content from IndexedDB.
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
export async function getArticle(id) {
  const content = await idbTransaction('readonly', (store) => store.get(id));
  if (!content) return null;

  // Merge with index entry for full article data
  const index = await getLibraryIndex();
  const entry = index.find((e) => e.id === id);
  return entry ? { ...entry, ...content } : content;
}

/**
 * Delete an article from the library.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteArticle(id) {
  // Remove from IndexedDB
  await idbTransaction('readwrite', (store) => store.delete(id));

  // Remove from index
  const index = await getLibraryIndex();
  const filtered = index.filter((e) => e.id !== id);
  await saveIndex(filtered);
}

/**
 * Update an existing article's content.
 * @param {string} id
 * @param {string} contentHtml - New content HTML
 * @param {Object} [counts] - Pre-computed { wordCount, blockCount }
 * @returns {Promise<void>}
 */
export async function updateArticle(id, contentHtml, counts = {}) {
  const existing = await idbTransaction('readonly', (store) => store.get(id));
  if (!existing) throw new Error(`Article ${id} not found`);

  await idbTransaction('readwrite', (store) =>
    store.put({ ...existing, contentHtml })
  );

  // Update counts in index if provided
  if (counts.wordCount != null || counts.blockCount != null) {
    const index = await getLibraryIndex();
    const entry = index.find((e) => e.id === id);
    if (entry) {
      if (counts.wordCount != null) entry.wordCount = counts.wordCount;
      if (counts.blockCount != null) entry.blockCount = counts.blockCount;
      await saveIndex(index);
    }
  }
}

/**
 * Check if a URL is already saved in the library.
 * @param {string} url
 * @returns {Promise<Object|null>} The matching index entry, or null
 */
export async function isUrlSaved(url) {
  const index = await getLibraryIndex();
  return index.find((e) => e.url === url) || null;
}

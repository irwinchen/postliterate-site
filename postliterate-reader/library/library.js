/**
 * Library page — displays saved articles with read/export/remove actions.
 */

const listEl = document.getElementById('article-list');
const countEl = document.getElementById('article-count');
const emptyEl = document.getElementById('empty-state');

/**
 * Format a timestamp as a relative or absolute date string.
 */
function formatDate(timestamp) {
  const date = new Date(timestamp);
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Create a card element for an article.
 */
function createCard(entry) {
  const card = document.createElement('div');
  card.className = 'library-card';
  card.dataset.id = entry.id;

  // Publication row
  const pubRow = document.createElement('div');
  pubRow.className = 'library-card-pub';

  if (entry.faviconUrl) {
    const favicon = document.createElement('img');
    favicon.className = 'library-card-favicon';
    favicon.src = entry.faviconUrl;
    favicon.alt = '';
    favicon.onerror = () => { favicon.style.display = 'none'; };
    pubRow.appendChild(favicon);
  }

  if (entry.siteName) {
    const site = document.createElement('span');
    site.className = 'library-card-site';
    site.textContent = entry.siteName;
    pubRow.appendChild(site);
  }

  if (entry.publishDate && entry.siteName) {
    const sep = document.createElement('span');
    sep.className = 'library-card-sep';
    sep.textContent = '\u00B7';
    pubRow.appendChild(sep);
  }

  if (entry.publishDate) {
    const date = document.createElement('span');
    date.textContent = entry.publishDate;
    pubRow.appendChild(date);
  }

  card.appendChild(pubRow);

  // Title
  const title = document.createElement('div');
  title.className = 'library-card-title';
  title.textContent = entry.title || 'Untitled';
  card.appendChild(title);

  // Byline
  if (entry.byline) {
    const byline = document.createElement('div');
    byline.className = 'library-card-byline';
    byline.textContent = entry.byline;
    card.appendChild(byline);
  }

  // Meta (word count + saved date)
  const meta = document.createElement('div');
  meta.className = 'library-card-meta';
  const parts = [];
  if (entry.wordCount) parts.push(`${entry.wordCount.toLocaleString()} words`);
  parts.push(`Saved ${formatDate(entry.savedAt)}`);
  meta.textContent = parts.join(' \u00B7 ');
  card.appendChild(meta);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'library-card-actions';

  const readBtn = document.createElement('button');
  readBtn.className = 'library-card-btn';
  readBtn.textContent = 'Read';
  readBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL(`viewer/viewer.html?id=${entry.id}`) });
  });

  const removeBtn = document.createElement('button');
  removeBtn.className = 'library-card-btn destructive';
  removeBtn.textContent = 'Remove';
  removeBtn.addEventListener('click', async () => {
    const resp = await chrome.runtime.sendMessage({ action: 'delete-article', id: entry.id });
    if (resp?.success) {
      card.remove();
      updateCount();
    }
  });

  actions.append(readBtn, removeBtn);
  card.appendChild(actions);

  return card;
}

/**
 * Update the article count display and empty state visibility.
 */
function updateCount() {
  const count = listEl.children.length;
  countEl.textContent = count > 0 ? `${count} article${count !== 1 ? 's' : ''}` : '';
  emptyEl.style.display = count === 0 ? 'block' : 'none';
}

/**
 * Load and render the library.
 */
async function init() {
  const resp = await chrome.runtime.sendMessage({ action: 'get-library-index' });
  if (!resp?.success) return;

  const index = resp.index || [];

  if (index.length === 0) {
    emptyEl.style.display = 'block';
    return;
  }

  for (const entry of index) {
    listEl.appendChild(createCard(entry));
  }
  updateCount();
}

init();

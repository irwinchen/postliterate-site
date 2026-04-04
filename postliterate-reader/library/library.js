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
 * Format milliseconds as a human-readable duration.
 */
function formatDuration(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 1) return '< 1 min';
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const remaining = mins % 60;
  return remaining > 0 ? `${hours}h ${remaining}min` : `${hours}h`;
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

  if (entry.sourceType === 'pdf') {
    const badge = document.createElement('span');
    badge.className = 'library-card-badge';
    badge.textContent = 'PDF';
    pubRow.appendChild(badge);
    if (entry.sourceFileName) {
      const fname = document.createElement('span');
      fname.textContent = entry.sourceFileName;
      pubRow.appendChild(fname);
    }
  } else if (entry.faviconUrl) {
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

  // Title row with progress ring
  const titleRow = document.createElement('div');
  titleRow.className = 'library-card-title-row';

  const title = document.createElement('div');
  title.className = 'library-card-title';
  title.textContent = entry.title || 'Untitled';
  titleRow.appendChild(title);

  // Progress ring
  const depth = entry.readingDepth || 0;
  const pct = Math.round(depth * 100);
  const size = 30;
  const strokeWidth = 2.5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - depth);
  const ringColor = entry.completed
    ? 'var(--ring-complete, #549E44)'
    : 'var(--ring-accent, #E53E33)';

  const ring = document.createElement('div');
  ring.className = 'library-card-ring';
  ring.title = entry.completed ? 'Finished' : `${pct}% read`;
  ring.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${radius}"
      fill="none" stroke="currentColor" stroke-width="${strokeWidth}" opacity="0.1"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${radius}"
      fill="none" stroke="${ringColor}" stroke-width="${strokeWidth}"
      stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"
      stroke-linecap="round" transform="rotate(-90 ${size / 2} ${size / 2})"
      style="transition: stroke-dashoffset 0.3s ease"/>
    ${pct > 0 ? `<text x="${size / 2}" y="${size / 2}" text-anchor="middle" dominant-baseline="central"
      font-size="10" font-family="Outfit, sans-serif" font-weight="500"
      fill="currentColor" opacity="0.6">${pct}</text>` : ''}
  </svg>`;
  titleRow.appendChild(ring);

  card.appendChild(titleRow);

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

  // Reading metrics (only if article has been read)
  if (entry.sessionCount > 0 || entry.readingDepth > 0) {
    // Reading stats row
    const statsRow = document.createElement('div');
    statsRow.className = 'library-card-stats';

    const statParts = [];
    if (entry.totalReadTimeMs > 0) {
      statParts.push(formatDuration(entry.totalReadTimeMs));
    }
    if (entry.sessionCount > 1) {
      statParts.push(`Read ${entry.sessionCount} times`);
    }
    statsRow.textContent = statParts.join(' \u00B7 ');

    if (entry.completed) {
      const badge = document.createElement('span');
      badge.className = 'library-card-completed';
      badge.textContent = '\u2713 Finished';
      statsRow.appendChild(badge);
    }

    card.appendChild(statsRow);
  }

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

  // Insights link
  document.getElementById('open-insights').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('insights/insights.html') });
  });

  // PDF import
  const importBtn = document.getElementById('import-pdf');
  const fileInput = document.getElementById('pdf-file-input');

  importBtn.addEventListener('click', () => fileInput.click());

  const progressEl = document.getElementById('import-progress');
  const statusEl = document.getElementById('import-status');
  const fillEl = document.getElementById('import-fill');
  const cancelBtn = document.getElementById('import-cancel');
  let activePort = null;

  function resetImportUI() {
    importBtn.textContent = 'Import PDF';
    importBtn.disabled = false;
    progressEl.style.display = 'none';
    fillEl.style.width = '0%';
    fileInput.value = '';
    activePort = null;
  }

  cancelBtn.addEventListener('click', () => {
    if (activePort) {
      activePort.disconnect();
      resetImportUI();
    }
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;

    importBtn.disabled = true;
    importBtn.textContent = 'Processing...';
    progressEl.style.display = 'block';
    statusEl.textContent = 'Reading file...';
    fillEl.style.width = '0%';

    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);

    const port = chrome.runtime.connect({ name: 'pdf-import' });
    activePort = port;

    port.onMessage.addListener((msg) => {
      if (msg.progress != null) {
        fillEl.style.width = `${Math.round(msg.progress * 100)}%`;
      }
      if (msg.status) {
        statusEl.textContent = msg.status;
      }
      if (msg.done && msg.entry) {
        const card = createCard(msg.entry);
        listEl.prepend(card);
        emptyEl.style.display = 'none';
        updateCount();
        resetImportUI();
      }
      if (msg.error) {
        const text = msg.reason === 'no-api-key'
          ? 'Set your Reducto API key in the popup settings'
          : msg.error;
        statusEl.textContent = text;
        fillEl.style.width = '0%';
        setTimeout(resetImportUI, 3000);
      }
    });

    port.onDisconnect.addListener(() => {
      if (activePort === port) resetImportUI();
    });

    port.postMessage({ base64, filename: file.name });
  });
}

init();

/**
 * Insights page — reading metrics dashboard.
 */

/**
 * Format milliseconds as human-readable duration.
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
 * Build the reading activity heatmap (last 12 weeks = 84 days).
 */
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function buildHeatmap(dayMap) {
  const container = document.getElementById('heatmap');
  const monthRow = document.getElementById('heatmap-months');
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Find max reading time for scaling
  const values = Object.values(dayMap);
  const maxMs = values.length > 0 ? Math.max(...values) : 0;

  // Exactly 12 columns × 7 rows = 84 cells, flowing column-first.
  const endDay = new Date(today);

  const thisSunday = new Date(today);
  thisSunday.setDate(thisSunday.getDate() - thisSunday.getDay());

  const startDay = new Date(thisSunday);
  startDay.setDate(startDay.getDate() - 11 * 7);

  // Build month labels — one per column, show label when month changes
  if (monthRow) {
    const weekStart = new Date(startDay);
    let prevMonth = -1;
    for (let w = 0; w < 12; w++) {
      const span = document.createElement('span');
      const month = weekStart.getMonth();
      if (month !== prevMonth) {
        span.textContent = MONTHS_SHORT[month];
        prevMonth = month;
      }
      monthRow.appendChild(span);
      weekStart.setDate(weekStart.getDate() + 7);
    }
  }

  // Emit exactly 84 cells
  const current = new Date(startDay);
  for (let i = 0; i < 84; i++) {
    const dateStr = current.toISOString().slice(0, 10);
    const cell = document.createElement('div');

    if (current > endDay) {
      cell.className = 'heatmap-day empty';
    } else {
      cell.className = 'heatmap-day';
      const readMs = dayMap[dateStr] || 0;
      if (readMs > 0 && maxMs > 0) {
        const ratio = readMs / maxMs;
        cell.style.opacity = (0.2 + ratio * 0.8).toFixed(2);
      }
      // Human-readable tooltip: "Mon, Mar 31: 12 min" or "Mon, Mar 31: No reading"
      const dayName = current.toLocaleDateString('en-US', { weekday: 'short' });
      const monthDay = current.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      cell.title = `${dayName}, ${monthDay}: ${readMs > 0 ? formatDuration(readMs) : 'No reading'}`;
    }

    container.appendChild(cell);
    current.setDate(current.getDate() + 1);
  }
}

/**
 * Compute streak and monthly stats from dayMap.
 */
function computeStreakInfo(dayMap) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Current streak
  let streak = 0;
  const check = new Date(today);
  while (true) {
    const key = check.toISOString().slice(0, 10);
    if (dayMap[key] && dayMap[key] > 0) {
      streak++;
      check.setDate(check.getDate() - 1);
    } else {
      break;
    }
  }

  // Days read this month
  const monthStr = today.toISOString().slice(0, 7); // YYYY-MM
  const daysThisMonth = Object.keys(dayMap).filter(
    (d) => d.startsWith(monthStr) && dayMap[d] > 0
  ).length;

  return { streak, daysThisMonth };
}

/**
 * Categorize session durations into buckets.
 */
function sessionDistribution(sessions) {
  if (sessions.length === 0) return 'No sessions recorded yet.';

  const durations = sessions.map((s) => Math.max(0, (s.endedAt || 0) - (s.startedAt || 0)));
  const buckets = { short: 0, medium: 0, long: 0 };

  for (const d of durations) {
    const mins = d / 60000;
    if (mins < 5) buckets.short++;
    else if (mins < 20) buckets.medium++;
    else buckets.long++;
  }

  const total = sessions.length;
  const dominant = Object.entries(buckets).sort((a, b) => b[1] - a[1])[0];
  const ranges = { short: 'under 5 minutes', medium: '5\u201320 minutes', long: 'over 20 minutes' };

  return `Most sessions are ${ranges[dominant[0]]} (${Math.round((dominant[1] / total) * 100)}% of ${total} sessions).`;
}

/**
 * Initialize the insights page.
 */
async function init() {
  // Library link
  document.getElementById('open-library').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('library/library.html') });
  });

  const resp = await chrome.runtime.sendMessage({ action: 'get-reading-stats' });
  if (!resp?.success) return;

  const stats = resp.stats;

  // Heatmap
  buildHeatmap(stats.dayMap || {});

  // Streak info
  const { streak, daysThisMonth } = computeStreakInfo(stats.dayMap || {});
  const streakParts = [];
  streakParts.push(`${daysThisMonth} day${daysThisMonth !== 1 ? 's' : ''} read this month`);
  if (streak > 0) {
    streakParts.push(`${streak} day streak`);
  }
  document.getElementById('streak-info').textContent = streakParts.join(' \u00B7 ');

  // Stat cards
  document.getElementById('completion-rate').textContent =
    stats.articlesRead > 0
      ? `${Math.round(stats.completionRate * 100)}%`
      : '--';

  document.getElementById('avg-depth').textContent =
    stats.articlesRead > 0
      ? `${Math.round(stats.avgDepth * 100)}%`
      : '--';

  document.getElementById('avg-session').textContent =
    stats.sessionCount > 0
      ? formatDuration(stats.avgSessionMs)
      : '--';

  document.getElementById('total-time').textContent =
    stats.totalReadTimeMs > 0
      ? formatDuration(stats.totalReadTimeMs)
      : '--';

  // Focus sessions
  document.getElementById('session-distribution').textContent =
    sessionDistribution(stats.sessions || []);

  // Longest session this week
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentSessions = (stats.sessions || []).filter((s) => s.startedAt >= oneWeekAgo);
  if (recentSessions.length > 0) {
    const longest = recentSessions.reduce((max, s) => {
      const dur = (s.endedAt || 0) - (s.startedAt || 0);
      return dur > max.dur ? { dur, s } : max;
    }, { dur: 0, s: null });
    if (longest.dur > 0) {
      document.getElementById('longest-session').textContent =
        `Longest session this week: ${formatDuration(longest.dur)}`;
    }
  }

  // Library stats
  document.getElementById('library-stats').textContent =
    `${stats.totalArticles} article${stats.totalArticles !== 1 ? 's' : ''} saved \u00B7 ` +
    `${stats.articlesCompleted} completed \u00B7 ` +
    `${formatDuration(stats.totalReadTimeMs)} total reading time`;

  // Top sources
  if (stats.topSources && stats.topSources.length > 0) {
    const section = document.getElementById('top-sources-section');
    section.style.display = '';
    const container = document.getElementById('top-sources');

    for (const source of stats.topSources) {
      const row = document.createElement('div');
      row.className = 'source-row';

      const name = document.createElement('span');
      name.className = 'source-name';
      name.textContent = source.name;
      row.appendChild(name);

      const detail = document.createElement('span');
      detail.className = 'source-detail';
      const parts = [`${source.articles} article${source.articles !== 1 ? 's' : ''}`];
      if (source.readTimeMs > 0) parts.push(formatDuration(source.readTimeMs));
      if (source.completed > 0) parts.push(`${source.completed} finished`);
      detail.textContent = parts.join(' \u00B7 ');
      row.appendChild(detail);

      container.appendChild(row);
    }
  }

  // Recently completed
  if (stats.recentlyCompleted && stats.recentlyCompleted.length > 0) {
    const section = document.getElementById('recently-completed-section');
    section.style.display = '';
    const container = document.getElementById('recently-completed');

    for (const article of stats.recentlyCompleted) {
      const item = document.createElement('div');
      item.className = 'completed-item';

      const titleEl = document.createElement('div');
      titleEl.className = 'completed-item-title';
      titleEl.textContent = article.title || 'Untitled';
      item.appendChild(titleEl);

      if (article.completedAt) {
        const dateEl = document.createElement('div');
        dateEl.className = 'completed-item-date';
        dateEl.textContent = new Date(article.completedAt).toLocaleDateString('en-US', {
          year: 'numeric', month: 'short', day: 'numeric',
        });
        item.appendChild(dateEl);
      }

      container.appendChild(item);
    }
  }
}

init();

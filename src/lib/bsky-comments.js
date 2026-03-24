/**
 * Pure functions for Bluesky comments integration.
 * No DOM access, no fetch — all I/O injected by callers.
 */

const BSKY_URL_RE = /\/profile\/([^/]+)\/post\/([^/?#]+)/;
const MAX_VISUAL_DEPTH = 4;

/**
 * Parse a Bluesky post URL into { handle, rkey }.
 * Returns null if the URL doesn't match.
 */
export function parseBskyUrl(url) {
  if (!url) return null;
  const match = url.match(BSKY_URL_RE);
  if (!match) return null;
  return { handle: match[1], rkey: match[2].replace(/\/$/, '') };
}

/**
 * Build an AT Protocol URI from a DID and record key.
 */
export function buildAtUri(did, rkey) {
  return `at://${did}/app.bsky.feed.post/${rkey}`;
}

/**
 * Escape HTML special characters to prevent XSS.
 */
export function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Format an ISO date string as a relative time.
 * Accepts `now` timestamp for testability.
 */
export function relativeTime(isoString, now = Date.now()) {
  const date = new Date(isoString);
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m`;
  if (diffHr < 24) return `${diffHr}h`;
  if (diffDay < 30) return `${diffDay}d`;

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[date.getMonth()];
  const day = date.getDate();
  const nowDate = new Date(now);

  if (date.getFullYear() === nowDate.getFullYear()) {
    return `${month} ${day}`;
  }
  return `${month} ${day}, ${date.getFullYear()}`;
}

/**
 * Transform a Bluesky getPostThread response into a flat array of comments.
 * Filters blocked/deleted posts, sorts by likes, caps depth.
 */
export function flattenThread(apiResponse) {
  const replies = apiResponse?.thread?.replies;
  if (!replies || replies.length === 0) return [];

  function walk(nodes, depth) {
    const valid = nodes.filter(
      (n) => n.$type === 'app.bsky.feed.defs#threadViewPost' && n.post?.author
    );

    const sorted = valid.sort((a, b) => (b.post.likeCount || 0) - (a.post.likeCount || 0));

    const result = [];
    for (const node of sorted) {
      const clampedDepth = Math.min(depth, MAX_VISUAL_DEPTH);
      const childComments = node.replies?.length ? walk(node.replies, depth + 1) : [];

      result.push({
        uri: node.post.uri,
        depth: clampedDepth,
        author: {
          did: node.post.author.did,
          handle: node.post.author.handle,
          displayName: node.post.author.displayName || node.post.author.handle,
          avatar: node.post.author.avatar || '',
        },
        text: node.post.record?.text || '',
        createdAt: node.post.record?.createdAt || '',
        likeCount: node.post.likeCount || 0,
        replies: childComments,
      });
    }
    return result;
  }

  return walk(replies, 0);
}

/**
 * Render a single comment (and its nested replies) to HTML.
 */
export function renderCommentHtml(comment, now = Date.now()) {
  const avatar = comment.author.avatar
    ? `<img class="bsky-comment-avatar" src="${escapeHtml(comment.author.avatar)}" alt="" width="32" height="32" loading="lazy" />`
    : `<div class="bsky-comment-avatar bsky-comment-avatar-fallback"></div>`;

  const rkey = comment.uri.split('/').pop();
  const postLink = `https://bsky.app/profile/${escapeHtml(comment.author.handle)}/post/${rkey}`;

  const nestedHtml = comment.replies.length
    ? `<div class="bsky-comment-nested">${comment.replies.map((r) => renderCommentHtml(r, now)).join('')}</div>`
    : '';

  return `<div class="bsky-comment">
  ${avatar}
  <div class="bsky-comment-header">
    <span class="bsky-comment-author">${escapeHtml(comment.author.displayName)}</span>
    <span class="bsky-comment-handle"><a href="https://bsky.app/profile/${escapeHtml(comment.author.handle)}" target="_blank" rel="noopener">@${escapeHtml(comment.author.handle)}</a></span>
  </div>
  <div class="bsky-comment-text">${escapeHtml(comment.text)}</div>
  <div class="bsky-comment-meta">
    <a href="${postLink}" target="_blank" rel="noopener">${relativeTime(comment.createdAt, now)}</a>
    ${comment.likeCount > 0 ? `<span>${comment.likeCount} like${comment.likeCount !== 1 ? 's' : ''}</span>` : ''}
  </div>
  ${nestedHtml}
</div>`;
}

/**
 * Render the full comments section HTML from an array of comments.
 */
export function renderCommentsSection(comments, now = Date.now()) {
  if (!comments.length) {
    return '<p class="bsky-comments-empty">No comments yet. Be the first to reply on Bluesky.</p>';
  }
  return comments.map((c) => renderCommentHtml(c, now)).join('');
}

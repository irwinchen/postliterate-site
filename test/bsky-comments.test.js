import { describe, it, expect } from 'vitest';
import {
  parseBskyUrl,
  buildAtUri,
  escapeHtml,
  relativeTime,
  flattenThread,
  renderCommentHtml,
  renderCommentsSection,
} from '../src/lib/bsky-comments.js';
import threadFixture from './fixtures/bsky-thread.json';

/** Recursively find a comment in a tree by predicate */
function findComment(comments, predicate) {
  for (const c of comments) {
    if (predicate(c)) return c;
    if (c.replies?.length) {
      const found = findComment(c.replies, predicate);
      if (found) return found;
    }
  }
  return undefined;
}

/** Collect all comments in a tree into a flat array */
function collectAll(comments) {
  const result = [];
  for (const c of comments) {
    result.push(c);
    if (c.replies?.length) result.push(...collectAll(c.replies));
  }
  return result;
}

// --- parseBskyUrl ---

describe('parseBskyUrl', () => {
  it('parses a valid Bluesky URL', () => {
    const result = parseBskyUrl('https://bsky.app/profile/tmonkey718.bsky.social/post/3abc123');
    expect(result).toEqual({ handle: 'tmonkey718.bsky.social', rkey: '3abc123' });
  });

  it('parses a URL with a DID as handle', () => {
    const result = parseBskyUrl('https://bsky.app/profile/did:plc:xyz789/post/3abc123');
    expect(result).toEqual({ handle: 'did:plc:xyz789', rkey: '3abc123' });
  });

  it('handles trailing slash', () => {
    const result = parseBskyUrl('https://bsky.app/profile/alice.bsky.social/post/3abc123/');
    expect(result).toEqual({ handle: 'alice.bsky.social', rkey: '3abc123' });
  });

  it('returns null for non-Bluesky URL', () => {
    expect(parseBskyUrl('https://twitter.com/user/status/123')).toBeNull();
  });

  it('returns null for invalid Bluesky URL', () => {
    expect(parseBskyUrl('https://bsky.app/profile/user')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseBskyUrl('')).toBeNull();
  });
});

// --- buildAtUri ---

describe('buildAtUri', () => {
  it('builds a correct AT URI', () => {
    expect(buildAtUri('did:plc:abc123', '3xyz789')).toBe(
      'at://did:plc:abc123/app.bsky.feed.post/3xyz789'
    );
  });
});

// --- escapeHtml ---

describe('escapeHtml', () => {
  it('escapes special HTML characters', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
  });

  it('escapes ampersands and single quotes', () => {
    expect(escapeHtml("AT&T's")).toBe("AT&amp;T&#39;s");
  });

  it('preserves normal text', () => {
    expect(escapeHtml('Hello world')).toBe('Hello world');
  });
});

// --- relativeTime ---

describe('relativeTime', () => {
  const now = new Date('2026-03-24T12:00:00.000Z').getTime();

  it('returns "just now" for seconds ago', () => {
    expect(relativeTime('2026-03-24T11:59:30.000Z', now)).toBe('just now');
  });

  it('returns minutes ago', () => {
    expect(relativeTime('2026-03-24T11:55:00.000Z', now)).toBe('5m');
  });

  it('returns hours ago', () => {
    expect(relativeTime('2026-03-24T10:00:00.000Z', now)).toBe('2h');
  });

  it('returns days ago', () => {
    expect(relativeTime('2026-03-21T12:00:00.000Z', now)).toBe('3d');
  });

  it('returns month and day for older dates same year', () => {
    expect(relativeTime('2026-01-15T12:00:00.000Z', now)).toBe('Jan 15');
  });

  it('returns month, day, and year for different year', () => {
    expect(relativeTime('2025-06-10T12:00:00.000Z', now)).toBe('Jun 10, 2025');
  });
});

// --- flattenThread ---

describe('flattenThread', () => {
  it('returns empty array for thread with no replies', () => {
    const emptyThread = {
      thread: {
        ...threadFixture.thread,
        replies: [],
      },
    };
    expect(flattenThread(emptyThread)).toEqual([]);
  });

  it('extracts top-level replies with depth 0', () => {
    const comments = flattenThread(threadFixture);
    const topLevel = comments.filter((c) => c.depth === 0);
    // Should have 2 (Alice and Bob, blocked/notFound filtered)
    expect(topLevel).toHaveLength(2);
  });

  it('extracts nested replies with correct depth', () => {
    const comments = flattenThread(threadFixture);
    const charlie = findComment(comments, (c) => c.author.handle === 'charlie.bsky.social');
    expect(charlie).toBeDefined();
    expect(charlie.depth).toBe(1);
  });

  it('filters out blocked posts', () => {
    const comments = flattenThread(threadFixture);
    const all = collectAll(comments);
    const blocked = all.find((c) => c.uri && c.uri.includes('blocked'));
    expect(blocked).toBeUndefined();
  });

  it('filters out notFound posts', () => {
    const comments = flattenThread(threadFixture);
    const all = collectAll(comments);
    const deleted = all.find((c) => c.uri && c.uri.includes('deleted'));
    expect(deleted).toBeUndefined();
  });

  it('sorts by likeCount descending at each level', () => {
    const comments = flattenThread(threadFixture);
    const topLevel = comments.filter((c) => c.depth === 0);
    // Bob (8 likes) should come before Alice (5 likes)
    expect(topLevel[0].author.handle).toBe('bob.bsky.social');
    expect(topLevel[1].author.handle).toBe('alice.bsky.social');
  });

  it('includes correct comment data', () => {
    const comments = flattenThread(threadFixture);
    const alice = findComment(comments, (c) => c.author.handle === 'alice.bsky.social');
    expect(alice.text).toBe('Great post! Really enjoyed reading it.');
    expect(alice.likeCount).toBe(5);
    expect(alice.author.displayName).toBe('Alice');
    expect(alice.author.avatar).toContain('cdn.bsky.app');
  });

  it('caps visual depth at 4', () => {
    // Build a deeply nested thread
    let deepReply = {
      $type: 'app.bsky.feed.defs#threadViewPost',
      post: {
        uri: 'at://did:plc:deep/app.bsky.feed.post/deep5',
        author: { did: 'did:plc:deep', handle: 'deep.bsky.social', displayName: 'Deep', avatar: '' },
        record: { text: 'Very deep', createdAt: '2026-03-20T18:00:00.000Z' },
        likeCount: 0, repostCount: 0, replyCount: 0,
      },
      replies: [],
    };
    for (let i = 4; i >= 0; i--) {
      deepReply = {
        $type: 'app.bsky.feed.defs#threadViewPost',
        post: {
          uri: `at://did:plc:deep/app.bsky.feed.post/deep${i}`,
          author: { did: 'did:plc:deep', handle: `level${i}.bsky.social`, displayName: `Level ${i}`, avatar: '' },
          record: { text: `Level ${i}`, createdAt: '2026-03-20T18:00:00.000Z' },
          likeCount: 0, repostCount: 0, replyCount: 0,
        },
        replies: [deepReply],
      };
    }
    const deepThread = { thread: { ...threadFixture.thread, replies: [deepReply] } };
    const comments = flattenThread(deepThread);
    const all = collectAll(comments);
    const maxDepth = Math.max(...all.map((c) => c.depth));
    expect(maxDepth).toBeLessThanOrEqual(4);
  });
});

// --- renderCommentHtml ---

describe('renderCommentHtml', () => {
  const comment = {
    uri: 'at://did:plc:user1/app.bsky.feed.post/reply1',
    depth: 0,
    author: {
      did: 'did:plc:user1',
      handle: 'alice.bsky.social',
      displayName: 'Alice',
      avatar: 'https://cdn.bsky.app/img/avatar.jpg',
    },
    text: 'Great post!',
    createdAt: '2026-03-24T11:00:00.000Z',
    likeCount: 5,
    replies: [],
  };

  it('contains the display name', () => {
    const html = renderCommentHtml(comment);
    expect(html).toContain('Alice');
  });

  it('contains a link to the handle profile', () => {
    const html = renderCommentHtml(comment);
    expect(html).toContain('href="https://bsky.app/profile/alice.bsky.social"');
    expect(html).toContain('@alice.bsky.social');
  });

  it('renders avatar as lazy-loaded img', () => {
    const html = renderCommentHtml(comment);
    expect(html).toContain('<img');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('cdn.bsky.app/img/avatar.jpg');
  });

  it('escapes text content', () => {
    const xssComment = { ...comment, text: '<script>alert("xss")</script>' };
    const html = renderCommentHtml(xssComment);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('displays like count', () => {
    const html = renderCommentHtml(comment);
    expect(html).toContain('5');
  });

  it('renders nested replies with nesting class', () => {
    const nested = {
      ...comment,
      depth: 1,
      replies: [{
        uri: 'at://did:plc:user2/app.bsky.feed.post/reply2',
        depth: 2,
        author: { did: 'did:plc:user2', handle: 'bob.bsky.social', displayName: 'Bob', avatar: '' },
        text: 'Nested reply',
        createdAt: '2026-03-24T11:30:00.000Z',
        likeCount: 0,
        replies: [],
      }],
    };
    const html = renderCommentHtml(nested);
    expect(html).toContain('bsky-comment-nested');
    expect(html).toContain('Nested reply');
  });
});

// --- renderCommentsSection ---

describe('renderCommentsSection', () => {
  it('shows empty message when no comments', () => {
    const html = renderCommentsSection([]);
    expect(html).toContain('No comments yet');
  });

  it('renders multiple comments', () => {
    const comments = [
      {
        uri: 'at://did:plc:user1/app.bsky.feed.post/r1',
        depth: 0,
        author: { did: 'did:plc:user1', handle: 'alice.bsky.social', displayName: 'Alice', avatar: '' },
        text: 'First!',
        createdAt: '2026-03-24T11:00:00.000Z',
        likeCount: 2,
        replies: [],
      },
      {
        uri: 'at://did:plc:user2/app.bsky.feed.post/r2',
        depth: 0,
        author: { did: 'did:plc:user2', handle: 'bob.bsky.social', displayName: 'Bob', avatar: '' },
        text: 'Second!',
        createdAt: '2026-03-24T11:30:00.000Z',
        likeCount: 1,
        replies: [],
      },
    ];
    const html = renderCommentsSection(comments);
    expect(html).toContain('First!');
    expect(html).toContain('Second!');
    expect(html).not.toContain('No comments yet');
  });
});

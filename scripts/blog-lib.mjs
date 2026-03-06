/**
 * Blog management library — shared by CLI (blog.mjs) and admin (admin.mjs).
 *
 * Rules:
 *  - No process.exit() — throw errors instead
 *  - No console.log() — return data, let callers format output
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
export const ROOT = join(__dirname, '..');
export const VAULT_DIR = join(process.env.HOME, 'vaults/PostLiterate/07_Blog');
export const CONTENT_DIR = join(ROOT, 'src/content/blog');
export const SYNC_MARKER = '{/* synced-draft */}';
export const PID_FILE = join(ROOT, '.dev-server.pid');

// ── PID file helpers ─────────────────────────────────────────────────

export function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readServerPid() {
  if (!existsSync(PID_FILE)) return null;
  const lines = readFileSync(PID_FILE, 'utf8').trim().split('\n');
  const pid = parseInt(lines[0], 10);
  const port = parseInt(lines[1], 10);
  if (isNaN(pid) || isNaN(port)) return null;
  return { pid, port };
}

export function writeServerPid(pid, port) {
  writeFileSync(PID_FILE, `${pid}\n${port}\n`);
}

export function removeServerPid() {
  if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
}

// ── Core helpers ─────────────────────────────────────────────────────

/** Return list of { slug, filename, path } for every .md/.mdx in the vault. */
export function getVaultPosts() {
  if (!existsSync(VAULT_DIR)) {
    throw new Error(`Vault directory not found: ${VAULT_DIR}`);
  }
  return readdirSync(VAULT_DIR)
    .filter((f) => /\.mdx?$/.test(f))
    .map((f) => ({
      filename: f,
      slug: f.replace(/\.mdx?$/, ''),
      path: join(VAULT_DIR, f),
    }));
}

/** Return list of content-dir files that have the sync marker. */
export function getSyncedDrafts() {
  if (!existsSync(CONTENT_DIR)) return [];
  return readdirSync(CONTENT_DIR)
    .filter((f) => /\.mdx?$/.test(f))
    .filter((f) => {
      const content = readFileSync(join(CONTENT_DIR, f), 'utf8');
      return content.includes(SYNC_MARKER);
    })
    .map((f) => ({
      filename: f,
      slug: f.replace(/\.mdx?$/, ''),
      path: join(CONTENT_DIR, f),
    }));
}

/** Read frontmatter value from file content (simple key: value regex). */
export function getFrontmatter(content, key) {
  const match = content.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : null;
}

/**
 * Transform Obsidian ==highlight==[^id] + footnote definitions into MarginNote components.
 * Pure string-in → string-out; no file I/O.
 */
export function transformMarginNotes(content) {
  // Collect footnote definitions
  const footnotes = new Map();
  const defPattern = /^\[\^(\w+)\]:\s*(.+)$/gm;
  let m;
  while ((m = defPattern.exec(content)) !== null) {
    let body = m[2];
    const after = content.slice(m.index + m[0].length);
    const cont = after.match(/^(\n {2,}.+)+/);
    if (cont) body += cont[0].replace(/\n {2,}/g, ' ');
    footnotes.set(m[1], body.trim());
  }

  // If no highlight+footnote pairs, return unchanged
  if (!/==([^=]+?)==\[\^(\w+)\]/.test(content)) return content;

  const mdToHtml = (t) => t
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<a href='$2'>$1</a>")
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
  const escapeAttr = (t) => t.replace(/"/g, '&quot;');

  const used = new Set();
  content = content.replace(/==([^=]+?)==\[\^(\w+)\]/g, (_, anchor, id) => {
    const note = footnotes.get(id);
    if (!note) return `${anchor}[^${id}]`;
    used.add(id);
    return `<MarginNote id="${id}" note="${escapeAttr(mdToHtml(note))}">${anchor}</MarginNote>`;
  });

  // Remove used footnote definitions
  for (const id of used) {
    content = content.replace(new RegExp(`^\\[\\^${id}\\]:\\s*.+(\\n {2,}.+)*\\n?`, 'gm'), '');
  }
  content = content.replace(/\n{3,}/g, '\n\n');

  // Add import after frontmatter if not present
  if (!content.includes("import MarginNote")) {
    const fmClose = content.indexOf('---', content.indexOf('---') + 3);
    if (fmClose !== -1) {
      content = content.slice(0, fmClose + 3) +
        "\nimport MarginNote from '../../components/MarginNote.astro';" +
        content.slice(fmClose + 3);
    }
  }

  return content;
}

/** Copy a vault post to content dir as .mdx with the sync marker after frontmatter. */
export function syncPost(slug) {
  const vault = getVaultPosts().find((p) => p.slug === slug);
  if (!vault) {
    throw new Error(`Post not found in vault: ${slug}`);
  }
  let content = readFileSync(vault.path, 'utf8');
  content = transformMarginNotes(content);
  const marked = content.replace(/^(---\n[\s\S]*?\n---)/m, `$1\n${SYNC_MARKER}`);
  const dest = join(CONTENT_DIR, `${slug}.mdx`);
  writeFileSync(dest, marked);
  return dest;
}

/**
 * Sync all vault drafts to content dir. Returns array of synced slugs.
 * If no drafts found, returns empty array.
 */
export function syncAllDrafts() {
  const vaultPosts = getVaultPosts();
  const drafts = vaultPosts.filter((p) => {
    const content = readFileSync(p.path, 'utf8');
    return getFrontmatter(content, 'status') === 'draft';
  });
  const synced = [];
  for (const d of drafts) {
    syncPost(d.slug);
    synced.push(d.slug);
  }
  return synced;
}

/** Remove all synced drafts from content dir. Returns count removed. */
export function cleanSyncedDrafts() {
  const drafts = getSyncedDrafts();
  for (const d of drafts) {
    unlinkSync(d.path);
  }
  return drafts.length;
}

/**
 * Return enriched list of all posts across vault and content dir.
 * Each entry: { slug, title, date, description, status, tags, inVault, inContent, isSynced }
 */
export function listPosts() {
  const vaultPosts = getVaultPosts();
  const contentFiles = existsSync(CONTENT_DIR)
    ? readdirSync(CONTENT_DIR).filter((f) => /\.mdx?$/.test(f))
    : [];
  const contentSlugs = contentFiles.map((f) => f.replace(/\.mdx?$/, ''));
  const syncedSlugs = getSyncedDrafts().map((d) => d.slug);

  const posts = [];

  for (const p of vaultPosts) {
    const content = readFileSync(p.path, 'utf8');
    const title = getFrontmatter(content, 'title') || p.slug;
    const date = getFrontmatter(content, 'date') || null;
    const description = getFrontmatter(content, 'description') || '';
    const vaultStatus = getFrontmatter(content, 'status') || 'unknown';
    const tags = getFrontmatter(content, 'tags') || '';

    const inContent = contentSlugs.includes(p.slug);
    const isSynced = syncedSlugs.includes(p.slug);

    let status = vaultStatus;
    if (inContent && !isSynced) {
      const pubContent = readFileSync(join(CONTENT_DIR, `${p.slug}.mdx`), 'utf8');
      const pubStatus = getFrontmatter(pubContent, 'status');
      if (pubStatus === 'published') status = 'published';
    }

    let location = 'vault only';
    if (isSynced) location = 'synced';
    else if (inContent) location = 'content';

    let needsRepublish = false;
    if (status === 'published' && inContent && !isSynced) {
      try {
        const vaultMtime = statSync(p.path).mtimeMs;
        const contentMtime = statSync(join(CONTENT_DIR, `${p.slug}.mdx`)).mtimeMs;
        needsRepublish = vaultMtime > contentMtime;
      } catch { /* ignore stat errors */ }
    }

    posts.push({ slug: p.slug, title, date, description, status, tags, location, inVault: true, inContent, isSynced, needsRepublish });
  }

  // Also include content-dir posts that aren't in the vault
  for (const f of contentFiles) {
    const slug = f.replace(/\.mdx?$/, '');
    if (posts.some((p) => p.slug === slug)) continue;
    const content = readFileSync(join(CONTENT_DIR, f), 'utf8');
    const title = getFrontmatter(content, 'title') || slug;
    const date = getFrontmatter(content, 'date') || null;
    const description = getFrontmatter(content, 'description') || '';
    const status = getFrontmatter(content, 'status') || 'unknown';
    const tags = getFrontmatter(content, 'tags') || '';
    const isSynced = syncedSlugs.includes(slug);

    posts.push({ slug, title, date, description, status, tags, location: isSynced ? 'synced' : 'content', inVault: false, inContent: true, isSynced });
  }

  return posts;
}

/**
 * Delete a draft: remove from vault (and clean any synced copy from content dir).
 * Returns { slug, deleted: true } on success, or { slug, deleted: false, error } on failure.
 */
export function deletePost(slug) {
  const vault = getVaultPosts().find((p) => p.slug === slug);
  if (!vault) {
    return { slug, deleted: false, error: `Post not found in vault: ${slug}` };
  }

  // Clean synced copy if present
  const synced = join(CONTENT_DIR, `${slug}.mdx`);
  if (existsSync(synced)) {
    const content = readFileSync(synced, 'utf8');
    if (content.includes(SYNC_MARKER)) {
      unlinkSync(synced);
    }
  }

  unlinkSync(vault.path);
  return { slug, deleted: true };
}

/**
 * Unpublish a post: delete from content dir, git add/commit/push.
 * Returns { slug, unpublished: true } on success, or { slug, unpublished: false, error } on failure.
 */
export function unpublishPost(slug) {
  const dest = join(CONTENT_DIR, `${slug}.mdx`);

  if (!existsSync(dest)) {
    return { slug, unpublished: false, error: `Post not found in content dir: ${slug}` };
  }

  unlinkSync(dest);

  try {
    execSync(`git add "${dest}"`, { cwd: ROOT, stdio: 'pipe' });
    execSync(`git commit -m "unpublish: ${slug}"`, { cwd: ROOT, stdio: 'pipe' });
    execSync(`git push origin main`, { cwd: ROOT, stdio: 'pipe' });
    return { slug, unpublished: true };
  } catch (err) {
    return { slug, unpublished: false, error: 'Git operation failed. File has been deleted but not committed.' };
  }
}

/**
 * Publish a post: copy from vault, set status to published, git add/commit/push.
 * Returns { slug, published: true } on success, or { slug, published: false, error } on failure.
 */
export function publishPost(slug) {
  const vault = getVaultPosts().find((p) => p.slug === slug);
  if (!vault) {
    return { slug, published: false, error: `Post not found in vault: ${slug}` };
  }

  const dest = join(CONTENT_DIR, `${slug}.mdx`);

  // Detect republish (file already exists as published, not a synced draft)
  let isRepublish = false;
  if (existsSync(dest)) {
    const existing = readFileSync(dest, 'utf8');
    if (existing.includes(SYNC_MARKER)) {
      unlinkSync(dest);
    } else {
      isRepublish = true;
    }
  }

  // Copy from vault, transform margin notes, set status to published
  let content = readFileSync(vault.path, 'utf8');
  content = transformMarginNotes(content);
  content = content.replace(/^status:\s*draft$/m, 'status: published');
  writeFileSync(dest, content);

  // Git add, commit, push
  const commitMsg = isRepublish ? `republish: ${slug}` : `publish: ${slug}`;
  try {
    execSync(`git add "${dest}"`, { cwd: ROOT, stdio: 'pipe' });
    execSync(`git commit -m "${commitMsg}"`, { cwd: ROOT, stdio: 'pipe' });
    execSync(`git push origin main`, { cwd: ROOT, stdio: 'pipe' });
    return { slug, published: true };
  } catch (err) {
    return { slug, published: false, error: 'Git operation failed. File has been copied but not committed.' };
  }
}

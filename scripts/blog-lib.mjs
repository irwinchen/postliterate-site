/**
 * Blog management library — shared by CLI (blog.mjs) and admin (admin.mjs).
 *
 * Rules:
 *  - No process.exit() — throw errors instead
 *  - No console.log() — return data, let callers format output
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
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

/** Copy a vault post to content dir as .mdx with the sync marker after frontmatter. */
export function syncPost(slug) {
  const vault = getVaultPosts().find((p) => p.slug === slug);
  if (!vault) {
    throw new Error(`Post not found in vault: ${slug}`);
  }
  const content = readFileSync(vault.path, 'utf8');
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

    posts.push({ slug: p.slug, title, date, description, status, tags, location, inVault: true, inContent, isSynced });
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

  // Remove any synced draft version first
  if (existsSync(dest)) {
    const existing = readFileSync(dest, 'utf8');
    if (existing.includes(SYNC_MARKER)) {
      unlinkSync(dest);
    }
  }

  // Copy from vault and set status to published
  let content = readFileSync(vault.path, 'utf8');
  content = content.replace(/^status:\s*draft$/m, 'status: published');
  writeFileSync(dest, content);

  // Git add, commit, push
  try {
    execSync(`git add "${dest}"`, { cwd: ROOT, stdio: 'pipe' });
    execSync(`git commit -m "publish: ${slug}"`, { cwd: ROOT, stdio: 'pipe' });
    execSync(`git push origin main`, { cwd: ROOT, stdio: 'pipe' });
    return { slug, published: true };
  } catch (err) {
    return { slug, published: false, error: 'Git operation failed. File has been copied but not committed.' };
  }
}

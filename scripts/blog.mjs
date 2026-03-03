#!/usr/bin/env node

/**
 * Blog preview & publish CLI.
 *
 * Usage:
 *   node scripts/blog.mjs list
 *   node scripts/blog.mjs preview [slug]
 *   node scripts/blog.mjs publish <slug>
 *   node scripts/blog.mjs clean
 */

import { watch } from 'node:fs';
import { spawn } from 'node:child_process';
import {
  ROOT,
  VAULT_DIR,
  getVaultPosts,
  getSyncedDrafts,
  syncPost,
  syncAllDrafts,
  cleanSyncedDrafts,
  listPosts,
  publishPost,
  unpublishPost,
  readServerPid,
  writeServerPid,
  removeServerPid,
  isProcessAlive,
} from './blog-lib.mjs';

// ── Commands ─────────────────────────────────────────────────────────

function cmdList() {
  let posts;
  try {
    posts = listPosts();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  if (posts.length === 0) {
    console.log('No posts found in vault.');
    return;
  }

  console.log('\nVault posts:\n');
  for (const p of posts) {
    if (!p.inVault) continue;
    let flag = '';
    if (p.isSynced) flag = ' [synced]';
    else if (p.inContent) flag = p.status === 'published' ? ' [published]' : ` [in content dir, status: ${p.status}]`;

    console.log(`  ${p.slug}  —  ${p.title}  (${p.status})${flag}`);
  }
  console.log('');
}

async function cmdPreview(slug) {
  // Validate vault dir exists early
  try {
    getVaultPosts();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  if (!slug) {
    // No slug given — sync all vault drafts
    const synced = syncAllDrafts();
    if (synced.length === 0) {
      console.log('No drafts found in vault.');
      return;
    }
    console.log(`Syncing ${synced.length} draft(s)...`);
    for (const s of synced) {
      console.log(`  synced: ${s}`);
    }
    slug = synced[0];
  } else {
    try {
      syncPost(slug);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
    console.log(`Synced: ${slug}`);
  }

  // Check for an existing dev server via PID file
  let weStartedServer = false;
  let devServer = null;
  let port = 4321;
  const existing = readServerPid();

  if (existing && isProcessAlive(existing.pid)) {
    port = existing.port;
    console.log(`\nDev server already running (PID ${existing.pid}, port ${port}). Attaching.\n`);
  } else {
    // Stale PID file — clean it up
    if (existing) {
      console.log('Removing stale PID file...');
      removeServerPid();
    }

    weStartedServer = true;
    port = 4321;
    console.log(`\nStarting dev server on port ${port}...\n`);

    devServer = spawn('npx', ['astro', 'dev', '--port', String(port)], {
      cwd: ROOT,
      stdio: 'inherit',
    });

    writeServerPid(devServer.pid, port);
  }

  const url = `http://localhost:${port}/blog/${slug}`;

  // Wait a moment for the server to start, then open browser
  setTimeout(() => {
    console.log(`\nOpening ${url}\n`);
    spawn('open', [url], { stdio: 'ignore' });
  }, weStartedServer ? 3000 : 500);

  // Watch vault dir for changes — resync on edit
  const watcher = watch(VAULT_DIR, (eventType, filename) => {
    if (!filename || !/\.mdx?$/.test(filename)) return;
    const changedSlug = filename.replace(/\.mdx?$/, '');
    const synced = getSyncedDrafts().map((d) => d.slug);
    if (synced.includes(changedSlug)) {
      syncPost(changedSlug);
      console.log(`  re-synced: ${changedSlug}`);
    }
  });

  // Cleanup on exit
  const cleanup = () => {
    console.log('\nCleaning up synced drafts...');
    watcher.close();
    const count = cleanSyncedDrafts();
    console.log(`Removed ${count} synced draft(s).`);

    if (weStartedServer && devServer) {
      devServer.kill();
      removeServerPid();
      console.log('Dev server stopped.');
    }

    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

function cmdPublish(slug) {
  if (!slug) {
    console.error('Usage: npm run blog:publish -- <slug>');
    process.exit(1);
  }

  const result = publishPost(slug);

  if (!result.published) {
    console.error(result.error);
    process.exit(1);
  }

  console.log(`\nPublished. Live in ~30s at postliterate.org/blog/${slug}`);
}

function cmdUnpublish(slug) {
  if (!slug) {
    console.error('Usage: npm run blog -- unpublish <slug>');
    process.exit(1);
  }

  const result = unpublishPost(slug);

  if (!result.unpublished) {
    console.error(result.error);
    process.exit(1);
  }

  console.log(`\nUnpublished "${slug}" — removed on next build.`);
}

function cmdClean() {
  const count = cleanSyncedDrafts();
  if (count === 0) {
    console.log('No synced drafts to clean.');
  } else {
    console.log(`Removed ${count} synced draft(s).`);
  }

  // Clean up stale PID file if the process is no longer alive
  const existing = readServerPid();
  if (existing) {
    if (isProcessAlive(existing.pid)) {
      console.log(`Dev server still running (PID ${existing.pid}, port ${existing.port}).`);
    } else {
      removeServerPid();
      console.log('Removed stale PID file.');
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case 'list':
    cmdList();
    break;
  case 'preview':
    cmdPreview(args[0]);
    break;
  case 'publish':
    cmdPublish(args[0]);
    break;
  case 'unpublish':
    cmdUnpublish(args[0]);
    break;
  case 'clean':
    cmdClean();
    break;
  default:
    console.log(`
Usage: node scripts/blog.mjs <command> [slug]

Commands:
  list              List vault drafts and their status
  preview [slug]    Sync draft(s) and start dev server with live reload
  publish <slug>    Copy from vault, set published, commit & push
  unpublish <slug>  Remove from content dir, commit & push
  clean             Remove leftover synced drafts
`);
    break;
}

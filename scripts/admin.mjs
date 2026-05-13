#!/usr/bin/env node

/**
 * Blog admin dashboard — local-dev-only HTTP server.
 *
 * Usage:  node scripts/admin.mjs
 *         npm run admin
 *
 * Serves a web dashboard on :4322 for managing blog posts.
 * Zero new dependencies — Node built-ins only.
 */

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  ROOT,
  listPosts,
  syncPost,
  syncAllDrafts,
  cleanSyncedDrafts,
  publishPost,
  unpublishPost,
  deletePost,
  readServerPid,
  writeServerPid,
  removeServerPid,
  isProcessAlive,
  urlSlug,
  generateProjectStatus,
} from './blog-lib.mjs';
import { refresh } from './dashboard/refresh.mjs';
import {
  getVaultWatch,
  setReadingQueueItemStatus,
  READING_STATUSES,
} from './dashboard/sources/vault-watch.mjs';
import { getTodos, toggleTodo } from './dashboard/sources/todos.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORT = 4322;
const DEV_PORT = 4321;

// ── Environment flags ─────────────────────────────────────────────────
// READ_ONLY=1  disables publish / unpublish / delete routes (set on Mini).
// HOST         bind address — set to 127.0.0.1 on MacBook to avoid LAN exposure.
const READ_ONLY = process.env.READ_ONLY === '1';
const HOST = process.env.HOST || undefined; // undefined → Node default (all interfaces)

// Track whether this admin process started the dev server
let devServerProcess = null;

// Concurrent-refresh guard. While set, /api/refresh returns 409 instead
// of starting a second refresh that would race with the first on the
// snapshot file write. Cleared in the route handler's finally block (and
// at the end of the startup-refresh below).
let refreshInFlight = null;
let adminStartedDevServer = false;

// ── Helpers ──────────────────────────────────────────────────────────

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function getDevServerStatus() {
  const info = readServerPid();
  if (info && isProcessAlive(info.pid)) {
    return { running: true, pid: info.pid, port: info.port };
  }
  // Clean stale PID file
  if (info) removeServerPid();
  return { running: false, pid: null, port: null };
}

function startDevServer() {
  const status = getDevServerStatus();
  if (status.running) return status;

  const child = spawn('npx', ['astro', 'dev', '--port', String(DEV_PORT)], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: true,
  });
  child.unref();

  writeServerPid(child.pid, DEV_PORT);
  devServerProcess = child;
  adminStartedDevServer = true;

  return { running: true, pid: child.pid, port: DEV_PORT };
}

function stopDevServer() {
  const status = getDevServerStatus();
  if (!status.running) return { running: false };

  try {
    process.kill(status.pid, 'SIGTERM');
  } catch { /* already dead */ }

  removeServerPid();
  devServerProcess = null;
  adminStartedDevServer = false;

  return { running: false };
}

// ── Route handler ────────────────────────────────────────────────────

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method;

  // CORS for local dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // GET / — serve dashboard HTML
    if (method === 'GET' && path === '/') {
      const html = readFileSync(join(__dirname, 'admin-ui.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    }

    // GET /api/posts — list all posts
    if (method === 'GET' && path === '/api/posts') {
      const posts = listPosts();
      json(res, { posts });
      return;
    }

    // POST /api/preview — sync draft(s) and return preview URL
    if (method === 'POST' && path === '/api/preview') {
      const body = await readBody(req);
      const slug = body.slug;

      let synced;
      if (slug) {
        syncPost(slug);
        synced = [slug];
      } else {
        synced = syncAllDrafts();
      }

      // Ensure dev server is running
      const devStatus = startDevServer();
      const previewSlug = slug || synced[0];
      const previewUrl = previewSlug
        ? `http://localhost:${devStatus.port}/blog/${urlSlug(previewSlug)}`
        : `http://localhost:${devStatus.port}`;

      json(res, { synced, previewUrl, devServer: devStatus });
      return;
    }

    // POST /api/publish — publish a post
    if (method === 'POST' && path === '/api/publish') {
      if (READ_ONLY) { json(res, { error: 'Server is in read-only mode' }, 403); return; }
      const body = await readBody(req);
      if (!body.slug) {
        json(res, { error: 'slug is required' }, 400);
        return;
      }
      const result = publishPost(body.slug);
      if (result.published) {
        try { generateProjectStatus(); } catch { /* non-fatal */ }
      }
      json(res, result, result.published ? 200 : 500);
      return;
    }

    // POST /api/unpublish — unpublish a post
    if (method === 'POST' && path === '/api/unpublish') {
      if (READ_ONLY) { json(res, { error: 'Server is in read-only mode' }, 403); return; }
      const body = await readBody(req);
      if (!body.slug) {
        json(res, { error: 'slug is required' }, 400);
        return;
      }
      const result = unpublishPost(body.slug);
      if (result.unpublished) {
        try { generateProjectStatus(); } catch { /* non-fatal */ }
      }
      json(res, result, result.unpublished ? 200 : 500);
      return;
    }

    // POST /api/delete — delete a draft from vault
    if (method === 'POST' && path === '/api/delete') {
      if (READ_ONLY) { json(res, { error: 'Server is in read-only mode' }, 403); return; }
      const body = await readBody(req);
      if (!body.slug) {
        json(res, { error: 'slug is required' }, 400);
        return;
      }
      const result = deletePost(body.slug);
      json(res, result, result.deleted ? 200 : 500);
      return;
    }

    // POST /api/clean — remove synced drafts
    if (method === 'POST' && path === '/api/clean') {
      const count = cleanSyncedDrafts();
      json(res, { cleaned: count });
      return;
    }

    // GET /api/dev-server — dev server status
    if (method === 'GET' && path === '/api/dev-server') {
      json(res, getDevServerStatus());
      return;
    }

    // POST /api/dev-server/start — start dev server
    if (method === 'POST' && path === '/api/dev-server/start') {
      json(res, startDevServer());
      return;
    }

    // POST /api/dev-server/stop — stop dev server
    if (method === 'POST' && path === '/api/dev-server/stop') {
      json(res, stopDevServer());
      return;
    }

    // GET /api/project-status — return activity dashboard data
    if (method === 'GET' && path === '/api/project-status') {
      try {
        const dataPath = join(ROOT, 'public/admin/project-status/data.json');
        const content = readFileSync(dataPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(content);
      } catch {
        json(res, { error: 'No project status data available' }, 404);
      }
      return;
    }

    // GET /api/config — client configuration flags
    if (method === 'GET' && path === '/api/config') {
      json(res, { readOnly: READ_ONLY });
      return;
    }

    // GET /dashboard — serve dashboard UI (same HTML, tab selected by hash)
    if (method === 'GET' && path === '/dashboard') {
      const html = readFileSync(join(__dirname, 'admin-ui.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    }

    // GET /dashboard/assets/<file> — static assets (icons, images).
    // Path-traversal guard: only direct children of the assets dir.
    if (method === 'GET' && path.startsWith('/dashboard/assets/')) {
      const name = path.slice('/dashboard/assets/'.length);
      if (!/^[\w.-]+$/.test(name)) { json(res, { error: 'invalid asset name' }, 400); return; }
      const assetPath = join(__dirname, 'dashboard/assets', name);
      if (!existsSync(assetPath)) { json(res, { error: 'not found' }, 404); return; }
      const ext = name.split('.').pop().toLowerCase();
      const contentType = {
        svg: 'image/svg+xml',
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        webp: 'image/webp',
        ico: 'image/x-icon',
      }[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      });
      res.end(readFileSync(assetPath));
      return;
    }

    // GET /dashboard/artifacts/<uuid>/<file> — extracted Claude.ai artifacts
    // (e.g. code blocks the model produced inside <antArtifact> tags).
    // Two-segment path; both segments validated by regex AND the resolved
    // path is verified to remain under ARTIFACTS_DIR before reading.
    // HTML is forced to text/plain and SVG is sent as attachment to avoid
    // inline rendering of LLM-generated content.
    if (method === 'GET' && path.startsWith('/dashboard/artifacts/')) {
      const rest = path.slice('/dashboard/artifacts/'.length);
      const parts = rest.split('/');
      if (parts.length !== 2 || !/^[\w.-]+$/.test(parts[0]) || !/^[\w.-]+$/.test(parts[1])) {
        json(res, { error: 'invalid artifact path' }, 400);
        return;
      }
      const ARTIFACTS_DIR = resolve(join(__dirname, 'dashboard/snapshots/artifacts'));
      const finalPath = resolve(join(ARTIFACTS_DIR, parts[0], parts[1]));
      if (!finalPath.startsWith(ARTIFACTS_DIR + sep)) {
        json(res, { error: 'invalid artifact path' }, 400);
        return;
      }
      if (!existsSync(finalPath)) { json(res, { error: 'not found' }, 404); return; }
      const ext = parts[1].split('.').pop().toLowerCase();
      const textTypes = new Set([
        'py', 'ts', 'tsx', 'js', 'jsx', 'md', 'sh', 'sql', 'css', 'yaml', 'yml',
        'txt', 'mmd', 'html',
      ]);
      let contentType;
      let extraHeaders = {};
      if (ext === 'json') contentType = 'application/json; charset=utf-8';
      else if (ext === 'svg') {
        contentType = 'image/svg+xml';
        extraHeaders['Content-Disposition'] = `attachment; filename="${parts[1]}"`;
      } else if (textTypes.has(ext)) contentType = 'text/plain; charset=utf-8';
      else contentType = 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=60',
        ...extraHeaders,
      });
      res.end(readFileSync(finalPath));
      return;
    }

    // GET /dashboard/figures/<file> — project images served from
    // public/images/figures/. Same security regex + content-type table as
    // /dashboard/assets/ above.
    if (method === 'GET' && path.startsWith('/dashboard/figures/')) {
      const name = path.slice('/dashboard/figures/'.length);
      if (!/^[\w.-]+$/.test(name)) { json(res, { error: 'invalid figure name' }, 400); return; }
      const figPath = join(__dirname, '..', 'public', 'images', 'figures', name);
      if (!existsSync(figPath)) { json(res, { error: 'not found' }, 404); return; }
      const ext = name.split('.').pop().toLowerCase();
      const contentType = {
        svg: 'image/svg+xml',
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        webp: 'image/webp',
        ico: 'image/x-icon',
      }[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      });
      res.end(readFileSync(figPath));
      return;
    }

    // GET /api/dashboard — serve latest snapshot
    if (method === 'GET' && path === '/api/dashboard') {
      const snapshotPath = join(__dirname, 'dashboard/snapshots/latest.json');
      if (!existsSync(snapshotPath)) {
        json(res, { error: 'No snapshot yet — run a refresh' }, 404);
        return;
      }
      const content = readFileSync(snapshotPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(content);
      return;
    }

    // POST /api/reading-queue/status — set a queue item's status + article frontmatter
    if (method === 'POST' && path === '/api/reading-queue/status') {
      if (READ_ONLY) { json(res, { error: 'Server is in read-only mode' }, 403); return; }
      const body = await readBody(req);
      if (
        !body ||
        typeof body.slug !== 'string' ||
        typeof body.status !== 'string' ||
        !READING_STATUSES.includes(body.status)
      ) {
        json(
          res,
          { error: `slug (string) and status (one of: ${READING_STATUSES.join(', ')}) are required` },
          400
        );
        return;
      }
      try {
        const result = setReadingQueueItemStatus(body.slug, body.status);

        // Patch snapshots/latest.json in place so reloads stay in sync
        const snapshotPath = join(__dirname, 'dashboard/snapshots/latest.json');
        let queue = null;
        if (existsSync(snapshotPath)) {
          try {
            const snap = JSON.parse(readFileSync(snapshotPath, 'utf8'));
            const fresh = await getVaultWatch();
            snap.vault_watch = fresh;
            writeFileSync(snapshotPath, JSON.stringify(snap, null, 2), 'utf8');
            queue = fresh.reading_queue;
          } catch (e) {
            console.warn(`  reading-queue snapshot patch failed — ${e.message}`);
          }
        }

        json(res, { ok: true, ...result, queue });
      } catch (err) {
        json(res, { error: err.message }, 500);
      }
      return;
    }

    // POST /api/todos/toggle — flip a TASKS.md checkbox
    if (method === 'POST' && path === '/api/todos/toggle') {
      if (READ_ONLY) { json(res, { error: 'Server is in read-only mode' }, 403); return; }
      const body = await readBody(req);
      if (!body || typeof body.line !== 'number' || typeof body.done !== 'boolean') {
        json(res, { error: 'line (number, 1-indexed) and done (boolean) are required' }, 400);
        return;
      }
      try {
        const result = toggleTodo(body.line, body.done);

        // Patch snapshots/latest.json so reloads see the new state.
        const snapshotPath = join(__dirname, 'dashboard/snapshots/latest.json');
        let reminders = null;
        if (existsSync(snapshotPath)) {
          try {
            const snap = JSON.parse(readFileSync(snapshotPath, 'utf8'));
            const fresh = await getTodos();
            snap.reminders = fresh;
            writeFileSync(snapshotPath, JSON.stringify(snap, null, 2), 'utf8');
            reminders = fresh;
          } catch (e) {
            console.warn(`  todos snapshot patch failed — ${e.message}`);
          }
        }

        json(res, { ok: true, ...result, reminders });
      } catch (err) {
        json(res, { error: err.message }, 500);
      }
      return;
    }

    // POST /api/refresh — regenerate dashboard snapshot on demand
    if (method === 'POST' && path === '/api/refresh') {
      if (refreshInFlight) {
        // 409 Conflict — well-defined "request can't proceed because of
        // current resource state". UI watches for this and shows a
        // different status message.
        json(
          res,
          {
            error: 'A refresh is already in progress. Please wait for it to finish.',
            already_running: true,
            started_at: refreshInFlight.startedAt,
          },
          409
        );
        return;
      }
      refreshInFlight = { startedAt: new Date().toISOString() };
      try {
        const snapshot = await refresh();
        json(res, { ok: true, refreshed_at: snapshot.refreshed_at });
      } catch (err) {
        json(res, { error: err.message }, 500);
      } finally {
        refreshInFlight = null;
      }
      return;
    }

    // 404
    json(res, { error: 'Not found' }, 404);
  } catch (err) {
    json(res, { error: err.message }, 500);
  }
}

// ── Server ───────────────────────────────────────────────────────────

const server = createServer(handleRequest);

server.listen(PORT, HOST, () => {
  const bindAddr = HOST ? HOST : '0.0.0.0';
  const localUrl = `http://localhost:${PORT}`;

  if (READ_ONLY) {
    console.log('  Running in READ-ONLY mode (publish/unpublish/delete disabled).');
  }

  // Refresh legacy project-status data
  try {
    generateProjectStatus();
    console.log('  Project status refreshed.');
  } catch (err) {
    console.log(`  Warning: could not refresh project status — ${err.message}`);
  }

  // Refresh dashboard snapshot. Take the lock so a fast manual /api/refresh
  // landing in the first ~minute of startup can't race with this one.
  refreshInFlight = { startedAt: new Date().toISOString(), source: 'startup' };
  refresh()
    .then(() => console.log('  Dashboard snapshot refreshed.'))
    .catch((err) => console.log(`  Warning: could not refresh dashboard snapshot — ${err.message}`))
    .finally(() => { refreshInFlight = null; });

  console.log(`\n  Blog admin running at ${localUrl}  (bound to ${bindAddr})\n`);
  // Only open browser when not in read-only mode (i.e. on the MacBook)
  if (!READ_ONLY) {
    spawn('open', [localUrl], { stdio: 'ignore' });
  }
});

// Cleanup on exit
function cleanup() {
  console.log('\nShutting down admin...');

  if (adminStartedDevServer) {
    console.log('Stopping dev server (admin started it)...');
    stopDevServer();
  }

  const count = cleanSyncedDrafts();
  if (count > 0) console.log(`Cleaned ${count} synced draft(s).`);

  server.close();
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

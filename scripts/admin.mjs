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
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
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

    // POST /api/refresh — regenerate dashboard snapshot on demand
    if (method === 'POST' && path === '/api/refresh') {
      try {
        const snapshot = await refresh();
        json(res, { ok: true, refreshed_at: snapshot.refreshed_at });
      } catch (err) {
        json(res, { error: err.message }, 500);
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

  // Refresh dashboard snapshot
  refresh()
    .then(() => console.log('  Dashboard snapshot refreshed.'))
    .catch((err) => console.log(`  Warning: could not refresh dashboard snapshot — ${err.message}`));

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

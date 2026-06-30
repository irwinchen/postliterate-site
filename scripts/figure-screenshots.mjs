/**
 * figure-screenshots.mjs
 *
 * Watches the figures defined in scripts/dashboard/figures.json and re-captures
 * a screenshot only for the figures whose underlying source files have changed
 * since the last run.
 *
 * How "changed" is detected:
 *   For each figure, a content hash is computed over its source file set
 *   (see FIGURE_SOURCES below). The hash is stored in a manifest at
 *   scripts/dashboard/.figure-hashes.json. On each run the hash is recomputed
 *   and compared; a mismatch (or a missing entry) marks the figure changed.
 *
 * What gets captured:
 *   A figure is "capturable" if it has a `page` field that points at a real
 *   route on the site (i.e. starts with "/" but not "/dashboard/"). For a
 *   changed capturable figure, the script loads the *live* page on
 *   postliterate.org in headless Chromium and overwrites the figure's registry
 *   still-image in public/images/figures/.
 *
 *   Capturing the live site (rather than a local build) is deliberate: this
 *   script is built to run unattended inside a sandboxed scheduled task where
 *   the project folder is mounted read-restricted and `astro build`/`astro dev`
 *   cannot run. Change detection still runs off the local `src/` files, so the
 *   task notices a change as soon as the source changes; the screenshot it
 *   captures is whatever is currently deployed. A source change that has not
 *   been pushed/deployed yet is captured on the first run after it goes live.
 *
 *   Figures that are not capturable (asset-only figures like the PISA SVGs, or
 *   figures with no page like the Virgil app shots) are still hash-tracked, but
 *   they are reported as "tracked, not screenshottable" rather than captured —
 *   their registry image already *is* the figure.
 *
 * Usage:
 *   node scripts/figure-screenshots.mjs               # capture changed figures
 *   node scripts/figure-screenshots.mjs --all         # capture every capturable figure
 *   node scripts/figure-screenshots.mjs --dry-run     # detect + report only, no writes
 *   node scripts/figure-screenshots.mjs --figure corpus          # limit to one figure id
 *   node scripts/figure-screenshots.mjs --base-url http://localhost:4321
 *
 * Exit code is 0 on success (including "nothing changed" and per-figure routing
 * failures, which are reported but non-fatal), 1 on a hard failure (registry
 * unreadable, browser could not launch, etc.).
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
  readdirSync,
} from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

// Keep the Chromium binary inside node_modules (PLAYWRIGHT_BROWSERS_PATH=0)
// rather than the per-user cache. node_modules lives in the repo, so the
// browser persists between runs even when the run happens in a fresh sandbox.
// Set before `playwright` is ever imported.
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || '0';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const REGISTRY_PATH = join(__dirname, 'dashboard', 'figures.json');
const MANIFEST_PATH = join(__dirname, 'dashboard', '.figure-hashes.json');
const REPORT_PATH = join(__dirname, 'dashboard', '.figure-screenshots-last-run.json');
const FIGURES_DIR = join(REPO_ROOT, 'public', 'images', 'figures');

const DEFAULT_BASE_URL = 'https://postliterate.org';

/**
 * Source file sets per figure id, used for change detection. Paths are relative
 * to the repo root. A path may be a file or a directory (directories are walked
 * recursively). If a figure id is not listed here, the script falls back to
 * hashing the figure's own registry image files.
 */
const FIGURE_SOURCES = {
  'literacy-level-mapping': ['public/images/figures/pisa-level-mapping.svg'],
  'literacy-isotype': ['public/images/figures/pisa-isotype.svg'],
  'brain-visualiser': [
    'src/pages/brain.astro',
    'src/pages/brain',
    'src/components/brain-3d',
    'src/lib/brain-viz',
  ],
  corpus: [
    'src/pages/corpus.astro',
    'src/components/corpus-bubbles',
    'src/lib/corpus-bubbles',
  ],
  timeline: ['public/timeline/index.html'],
  tokens: [
    'src/pages/tokens.astro',
    'src/components/corpus-tokens',
    'src/lib/corpus-tokens',
  ],
  'virgil-reader-extension': ['public/images/figures/virgil-reader-extension.png'],
  'deep-reading-minority': ['src/pages/literacy.html'],
  'pisa-ladder': ['src/pages/pisa.html'],
  'literacy-metric': ['src/pages/literacy-metric.html'],
  'what-is-post-literacy': ['src/pages/what-is-post-literacy.html'],
  'explaining-post-literacy': ['src/pages/explaining-post-literacy.html'],
  annotator: ['src/pages/annotator.astro', 'src/components/annotator'],
  // `virgil` has no source mapping — it falls back to its registry images,
  // which are currently missing, so it is reported as such.
};

/**
 * Per-figure capture tuning. `settle` is how long (ms) to wait after the page
 * reaches network-idle before the screenshot, to let JS-driven figures finish
 * animating/laying out. `viewport` sets the browser size. `fullPage` captures
 * the whole scroll height instead of just the viewport.
 */
const CAPTURE_CONFIG = {
  _default: { settle: 4000, viewport: { width: 1440, height: 900 }, fullPage: false },
  corpus: { settle: 5000 },
  timeline: { settle: 2500 },
  tokens: { settle: 3500 },
  'brain-visualiser': { settle: 5000 },
};

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { all: false, dryRun: false, figure: null, baseUrl: DEFAULT_BASE_URL };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all' || a === '--force') args.all = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--figure') args.figure = argv[++i] || null;
    else if (a === '--base-url') args.baseUrl = (argv[++i] || DEFAULT_BASE_URL).replace(/\/$/, '');
    else if (a === '--help' || a === '-h') {
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
      process.exit(0);
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Hashing / change detection
// ---------------------------------------------------------------------------

/** Recursively collect every file under a path (which may be a file or dir). */
function collectFiles(absPath) {
  if (!existsSync(absPath)) return [];
  const st = statSync(absPath);
  if (st.isFile()) return [absPath];
  if (!st.isDirectory()) return [];
  const out = [];
  for (const entry of readdirSync(absPath)) {
    // Skip noise that does not affect the rendered figure.
    if (entry === '.DS_Store' || entry === '.gitkeep') continue;
    out.push(...collectFiles(join(absPath, entry)));
  }
  return out;
}

/**
 * Compute a stable content hash for a figure's source set. The hash folds in
 * each file's repo-relative path and its bytes, with files sorted by path so
 * the result is order-independent. Returns { hash, fileCount, missing }.
 */
function hashFigureSources(figure) {
  const sourcePaths =
    FIGURE_SOURCES[figure.id] ||
    (figure.images || []).map((img) => join('public/images/figures', img.file));

  const files = [];
  const missing = [];
  for (const rel of sourcePaths) {
    const abs = join(REPO_ROOT, rel);
    const found = collectFiles(abs);
    if (found.length === 0) missing.push(rel);
    files.push(...found);
  }

  files.sort();
  const h = createHash('sha256');
  for (const abs of files) {
    const rel = relative(REPO_ROOT, abs).split(sep).join('/');
    h.update(rel);
    h.update('\0');
    h.update(readFileSync(abs));
    h.update('\0');
  }
  return { hash: h.digest('hex'), fileCount: files.length, missing };
}

function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) return { version: 1, updated: null, figures: {} };
  try {
    const m = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    if (!m.figures) m.figures = {};
    return m;
  } catch (err) {
    console.warn(`! Could not parse manifest (${err.message}) — treating as empty.`);
    return { version: 1, updated: null, figures: {} };
  }
}

function saveManifest(manifest) {
  manifest.updated = new Date().toISOString();
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// Capturability
// ---------------------------------------------------------------------------

/**
 * A figure is capturable when it has a `page` route on the site itself.
 * `/dashboard/...` routes belong to the local admin tool, not postliterate.org,
 * so they are treated as not capturable. Returns { capturable, reason }.
 */
function capturability(figure) {
  const page = figure.page;
  if (!page) return { capturable: false, reason: 'no page route in registry' };
  if (!page.startsWith('/')) return { capturable: false, reason: `page is not a site route: ${page}` };
  if (page.startsWith('/dashboard/'))
    return { capturable: false, reason: 'page is a local dashboard route, not a public page' };
  const targetImage = (figure.images && figure.images[0] && figure.images[0].file) || null;
  if (!targetImage) return { capturable: false, reason: 'no registry image to overwrite' };
  return { capturable: true, reason: null, targetImage };
}

// ---------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------

/**
 * Import Playwright and launch Chromium. If the browser binary is missing, run
 * `npx playwright install chromium` once and retry, so a scheduled task can
 * self-heal on a fresh environment.
 */
async function launchBrowser() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (err) {
    throw new Error(
      `Playwright is not installed. Run: npm install -D playwright && npx playwright install chromium\n(${err.message})`,
    );
  }

  // `channel: 'chromium'` runs the full bundled Chromium build in headless
  // mode, rather than the separate `chromium-headless-shell` binary. This keeps
  // the script working with only `npx playwright install chromium` installed.
  const launchOpts = { headless: true, channel: 'chromium' };

  try {
    return await chromium.launch(launchOpts);
  } catch (err) {
    const msg = String(err && err.message);
    if (/Executable doesn'?t exist|playwright install/i.test(msg)) {
      console.log('• Chromium binary missing — running `npx playwright install chromium` ...');
      const r = spawnSync('npx', ['playwright', 'install', 'chromium'], {
        cwd: REPO_ROOT,
        stdio: 'inherit',
      });
      if (r.status !== 0) throw new Error('`npx playwright install chromium` failed.');
      return await chromium.launch(launchOpts);
    }
    throw err;
  }
}

/**
 * Capture one figure from the live site. Returns { ok, status, bytes?, error? }.
 *
 * Two failure modes are detected and reported (without writing a file):
 *   - the page itself returns a non-2xx status
 *   - the page redirects (e.g. an Astro static redirect via meta-refresh) and
 *     the final destination is a 404 — this is how a broken `page` route in
 *     the registry surfaces, e.g. /brain -> /brain/four-modes.
 */
async function captureFigure(browser, figure, baseUrl, outPath, dryRun) {
  const cfg = { ...CAPTURE_CONFIG._default, ...(CAPTURE_CONFIG[figure.id] || {}) };
  const requestedUrl = `${baseUrl}${figure.page}`;
  const context = await browser.newContext({
    viewport: cfg.viewport,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  try {
    let response;
    try {
      response = await page.goto(requestedUrl, { waitUntil: 'networkidle', timeout: 45000 });
    } catch (err) {
      // networkidle can time out on figures that poll/animate forever; fall
      // back to a plain load and continue.
      response = await page.goto(requestedUrl, { waitUntil: 'load', timeout: 45000 });
    }
    const status = response ? response.status() : 0;
    if (status >= 400 || status === 0) {
      return { ok: false, status, error: `${figure.page} returned HTTP ${status}` };
    }

    // Let the page settle, then check whether a client-side/meta redirect moved
    // us somewhere broken.
    await page.waitForTimeout(cfg.settle);
    const finalUrl = page.url();
    if (finalUrl.replace(/\/$/, '') !== requestedUrl.replace(/\/$/, '')) {
      let finalStatus = null;
      try {
        const probe = await fetch(finalUrl, { method: 'GET' });
        finalStatus = probe.status;
      } catch {
        /* leave finalStatus null */
      }
      if (finalStatus !== null && finalStatus >= 400) {
        return {
          ok: false,
          status: finalStatus,
          error: `${figure.page} redirects to ${finalUrl} which returned HTTP ${finalStatus}`,
        };
      }
    }

    if (dryRun) {
      return { ok: true, status, bytes: 0, dryRun: true, finalUrl };
    }
    const buf = await page.screenshot({ fullPage: cfg.fullPage, type: 'png' });
    writeFileSync(outPath, buf);
    return { ok: true, status, bytes: buf.length, finalUrl };
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!existsSync(REGISTRY_PATH)) {
    console.error(`✗ Registry not found: ${REGISTRY_PATH}`);
    process.exit(1);
  }
  let registry;
  try {
    registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
  } catch (err) {
    console.error(`✗ Could not parse figures.json: ${err.message}`);
    process.exit(1);
  }
  if (!Array.isArray(registry)) {
    console.error('✗ figures.json must be an array of figure entries.');
    process.exit(1);
  }

  const manifest = loadManifest();
  const runStartedAt = new Date().toISOString();

  // --- Pass 1: hash every figure, decide what changed -----------------------
  const figures = registry
    .filter((f) => !args.figure || f.id === args.figure)
    .map((figure) => {
      const { hash, fileCount, missing } = hashFigureSources(figure);
      const prev = manifest.figures[figure.id] || {};
      const changed = args.all || prev.hash !== hash;
      const cap = capturability(figure);
      return { figure, hash, fileCount, missing, prevHash: prev.hash || null, changed, cap };
    });

  if (args.figure && figures.length === 0) {
    console.error(`✗ No figure with id "${args.figure}" in the registry.`);
    process.exit(1);
  }

  const toCapture = figures.filter((f) => f.changed && f.cap.capturable);
  const changedButNotCapturable = figures.filter((f) => f.changed && !f.cap.capturable);
  const unchanged = figures.filter((f) => !f.changed);

  console.log('');
  console.log(`Figure change scan  (capturing from ${args.baseUrl})`);
  console.log('──────────────────');
  for (const f of figures) {
    const mark = f.changed ? (f.cap.capturable ? '● changed' : '● changed*') : '· same';
    const note = f.cap.capturable
      ? f.figure.page
      : `not screenshottable — ${f.cap.reason}`;
    console.log(`  ${mark.padEnd(11)} ${f.figure.id.padEnd(26)} ${note}`);
    if (f.missing.length) {
      console.log(`${' '.repeat(40)}↳ missing source(s): ${f.missing.join(', ')}`);
    }
  }
  console.log('');
  console.log(
    `  ${toCapture.length} to capture · ${changedButNotCapturable.length} changed but not screenshottable · ${unchanged.length} unchanged`,
  );
  if (changedButNotCapturable.length) {
    console.log('  (* = source changed, but the figure has no public page to screenshot)');
  }
  console.log('');

  const report = {
    runStartedAt,
    runFinishedAt: null,
    baseUrl: args.baseUrl,
    dryRun: args.dryRun,
    forced: args.all,
    captured: [],
    failed: [],
    changedNotCapturable: changedButNotCapturable.map((f) => ({
      id: f.figure.id,
      reason: f.cap.reason,
    })),
    unchanged: unchanged.map((f) => f.figure.id),
  };

  // --- Pass 2: capture --------------------------------------------------------
  let browser = null;
  let hardFailure = null;

  if (toCapture.length > 0) {
    try {
      browser = await launchBrowser();

      for (const f of toCapture) {
        const outPath = join(FIGURES_DIR, f.cap.targetImage);
        process.stdout.write(`  capturing ${f.figure.id} → ${f.cap.targetImage} ... `);
        try {
          const res = await captureFigure(browser, f.figure, args.baseUrl, outPath, args.dryRun);
          if (res.ok) {
            console.log(
              res.dryRun
                ? `ok (HTTP ${res.status}, dry run — not written)`
                : `ok (HTTP ${res.status}, ${(res.bytes / 1024).toFixed(0)} KB)`,
            );
            report.captured.push({
              id: f.figure.id,
              page: f.figure.page,
              image: f.cap.targetImage,
              bytes: res.bytes,
              dryRun: !!res.dryRun,
            });
            // Only advance the stored hash once the capture actually succeeded
            // (or would have, in a dry run).
            manifest.figures[f.figure.id] = {
              hash: f.hash,
              image: f.cap.targetImage,
              lastCaptured: args.dryRun
                ? manifest.figures[f.figure.id]?.lastCaptured || null
                : new Date().toISOString(),
            };
          } else {
            console.log(`SKIPPED — ${res.error}`);
            report.failed.push({ id: f.figure.id, page: f.figure.page, error: res.error });
            // Do NOT advance the hash: a routing problem should keep showing up
            // as "changed" on the next run until it is fixed.
          }
        } catch (err) {
          console.log(`ERROR — ${err.message}`);
          report.failed.push({ id: f.figure.id, page: f.figure.page, error: err.message });
        }
      }
    } catch (err) {
      hardFailure = err;
      console.error(`\n✗ ${err.message}`);
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch {
          /* ignore */
        }
      }
    }
  }

  // --- Pass 3: record hashes for figures that need no capture ---------------
  // Changed-but-not-capturable and unchanged figures still get their current
  // hash written so the manifest stays a complete, current picture.
  if (!hardFailure) {
    for (const f of figures) {
      const alreadyHandled = report.captured.some((c) => c.id === f.figure.id);
      const failed = report.failed.some((c) => c.id === f.figure.id);
      if (alreadyHandled || failed) continue;
      const prev = manifest.figures[f.figure.id] || {};
      manifest.figures[f.figure.id] = {
        hash: f.hash,
        image: (f.figure.images && f.figure.images[0] && f.figure.images[0].file) || null,
        lastCaptured: prev.lastCaptured || null,
      };
    }
  }

  report.runFinishedAt = new Date().toISOString();

  // --- Persist manifest + report --------------------------------------------
  if (!args.dryRun && !hardFailure) {
    saveManifest(manifest);
  }
  if (!args.dryRun) {
    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n', 'utf8');
  }

  // --- Summary --------------------------------------------------------------
  console.log('');
  console.log('Summary');
  console.log('───────');
  if (report.captured.length) {
    for (const c of report.captured) {
      console.log(`  ✓ ${c.id} — ${c.image}${c.dryRun ? ' (dry run)' : ''}`);
    }
  }
  if (report.failed.length) {
    for (const c of report.failed) {
      console.log(`  ✗ ${c.id} — ${c.error}`);
    }
  }
  if (changedButNotCapturable.length) {
    for (const c of report.changedNotCapturable) {
      console.log(`  ⚠ ${c.id} — source changed but ${c.reason}`);
    }
  }
  if (!report.captured.length && !report.failed.length && !changedButNotCapturable.length) {
    console.log('  Nothing changed. No screenshots taken.');
  }
  console.log('');

  if (hardFailure) process.exit(1);
  // A routing/capture failure is reported but does not fail the whole run, so a
  // scheduled task still records the manifest progress for the figures that
  // did succeed. Flip this to `process.exit(1)` if you want failures to page.
  process.exit(0);
}

main().catch((err) => {
  console.error(`\n✗ Unexpected error: ${err && err.stack ? err.stack : err}`);
  process.exit(1);
});

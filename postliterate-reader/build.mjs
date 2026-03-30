/**
 * Build script — bundles content scripts for Chrome extension.
 *
 * Content scripts can't use ES modules, so we bundle them with esbuild.
 * The output goes to dist/ which is the loadable extension directory.
 */

import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, existsSync } from 'node:fs';

const isWatch = process.argv.includes('--watch');

// Ensure dist directory
mkdirSync('dist', { recursive: true });

// Bundle content script (ESM → IIFE)
const contentBuild = {
  entryPoints: ['content/content-script.js'],
  bundle: true,
  format: 'iife',
  outfile: 'dist/content/content-script.js',
  target: 'chrome123',
};

// Bundle viewer (ESM → IIFE) — imports reading-ui without Readability/tagger
const viewerBuild = {
  entryPoints: ['viewer/viewer.js'],
  bundle: true,
  format: 'iife',
  outfile: 'dist/viewer/viewer.js',
  target: 'chrome123',
};

// Copy static files to dist
function copyStatic() {
  const copies = [
    ['manifest.json', 'dist/manifest.json'],
    ['lib/readability.js', 'dist/lib/readability.js'],
    ['content/styles.css', 'dist/content/styles.css'],
    ['popup', 'dist/popup'],
    ['background/service-worker.js', 'dist/background/service-worker.js'],
    ['icons', 'dist/icons'],
    ['fonts', 'dist/fonts'],
    ['library', 'dist/library'],
    ['viewer/viewer.html', 'dist/viewer/viewer.html'],
  ];

  for (const [src, dest] of copies) {
    if (!existsSync(src)) continue;
    const destDir = dest.substring(0, dest.lastIndexOf('/'));
    mkdirSync(destDir, { recursive: true });
    cpSync(src, dest, { recursive: true });
  }
}

async function build() {
  copyStatic();

  if (isWatch) {
    const ctx = await esbuild.context(contentBuild);
    const ctx2 = await esbuild.context(viewerBuild);
    await ctx.watch();
    await ctx2.watch();
    console.log('Watching for changes...');
  } else {
    await Promise.all([
      esbuild.build(contentBuild),
      esbuild.build(viewerBuild),
    ]);
    console.log('Build complete → dist/');
  }
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});

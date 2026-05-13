#!/usr/bin/env node
/**
 * Precompute the d3 zoomable circle-pack layout for the corpus-bubbles
 * figure.
 *
 * The full hierarchy (root → 11 categories → ~30 leaves) is packed in one
 * pass with `d3.pack()`. Every descendant is positioned inside its parent;
 * children inherit the parent's palette color so each category reads as a
 * color family. The renderer ships a single JSON file (`tree.json`) and
 * handles zoom-on-click via a transform on a wrapping `<g>` — no per-parent
 * drill-in files, no force compaction.
 *
 * Output: `public/corpus-bubbles/tree.json` with `{ canvas, region, nodes }`.
 *
 * @module corpus-bubbles/build
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hierarchy, pack } from 'd3-hierarchy';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const REPO_ROOT = join(__dirname, '..', '..', '..');
const STRUCTURE_PATH = join(
  REPO_ROOT,
  'public',
  'corpus-treemap',
  'structure.json',
);
const OUTPUT_DIR = join(REPO_ROOT, 'public', 'corpus-bubbles');

// ---------- Configuration ----------

// SVG viewBox. ~16:9 so the chart fills modern viewports with minimal
// letterboxing under `preserveAspectRatio="xMidYMid meet"`. The renderer
// reads these back from `tree.json`.
const CANVAS_W = 1600;
const CANVAS_H = 900;

// Bubble region: where the packed cluster lives inside the viewBox. Pushed
// left of canvas center so the sidenote panel has room on the right.
// `REGION_DIAMETER` is also the size the focus node fills when zoomed in
// (the renderer interpolates its view to this dimension).
const REGION_CX = 500;
const REGION_CY = 450;
const REGION_DIAMETER = 820;

const PACK_PADDING = 4;

// Color palette by category id. First seven colors come from the user's
// reference palette (a muted, slightly desaturated set used in an
// information-design poster); the last four round out the 11 categories.
const PALETTE = {
  web: '#809B57',
  logic: '#7B5567',
  academic: '#5BA7A3',
  books: '#E2A82B',
  forums: '#8E2A3A',
  wiki: '#C5B746',
  multilingual: '#E29487',
  legal: '#6F8088',
  transcripts: '#B57480',
  synthetic: '#A8B570',
  unknown: '#383838',
};

// ---------- Helpers ----------

/**
 * Walk the structure tree and apply the palette: each top-level category
 * gets its mapped color, and children inherit their parent's color so each
 * category reads as a single color family at every zoom level.
 */
function applyPalette(node, inheritedColor) {
  const color = PALETTE[node.id] || node.color || inheritedColor || null;
  const out = { ...node, color };
  if (Array.isArray(node.children)) {
    out.children = node.children.map((c) => applyPalette(c, color));
  }
  return out;
}

/**
 * Translate a packed `d3.hierarchy` node into the plain object the renderer
 * will consume. Keeps the panel content (description, bullets, screenshot)
 * inline so the renderer needs no secondary lookup.
 */
function nodeOut(n, dx, dy, parentId) {
  const d = n.data;
  return {
    id: d.id,
    label: d.label || '',
    value: d.value || 0,
    color: d.color || null,
    depth: n.depth,
    parentId,
    childIds: n.children ? n.children.map((c) => c.data.id) : [],
    x: n.x + dx,
    y: n.y + dy,
    r: n.r,
    description: d.description || '',
    bullets: d.bullets || [],
    screenshot: d.screenshot || null,
    screenshotCaption: d.screenshotCaption || '',
    isUnknown: !!d.isUnknown,
  };
}

// ---------- Main ----------

function main() {
  const t0 = Date.now();
  const structure = JSON.parse(readFileSync(STRUCTURE_PATH, 'utf8'));
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const colored = applyPalette(structure, null);

  // d3.hierarchy + sum + sort, then pack into a circle of REGION_DIAMETER.
  // d3.pack treats the supplied size as a square — the root circle ends up
  // tangent to all four edges, so REGION_DIAMETER is also the root diameter.
  const root = hierarchy(colored)
    .sum((d) => (d.children && d.children.length ? 0 : d.value || 0))
    .sort((a, b) => (b.value || 0) - (a.value || 0));

  pack().size([REGION_DIAMETER, REGION_DIAMETER]).padding(PACK_PADDING)(root);

  const dx = REGION_CX - REGION_DIAMETER / 2;
  const dy = REGION_CY - REGION_DIAMETER / 2;

  const nodes = root.descendants().map((n) =>
    nodeOut(n, dx, dy, n.parent ? n.parent.data.id : null),
  );

  const out = {
    canvas: { viewBox: [0, 0, CANVAS_W, CANVAS_H] },
    region: { cx: REGION_CX, cy: REGION_CY, diameter: REGION_DIAMETER },
    rootId: root.data.id,
    nodes,
  };

  writeFileSync(
    join(OUTPUT_DIR, 'tree.json'),
    JSON.stringify(out),
    'utf8',
  );

  const dt = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(
    `Done. tree.json (${nodes.length} nodes) written to ${OUTPUT_DIR} in ${dt}s.`,
  );
}

main();

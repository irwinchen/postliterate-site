#!/usr/bin/env node
/**
 * Precompute bubble-packing layouts for the corpus-voronoi figure.
 *
 * Note on naming: the directory is still called `corpus-voronoi` for historical
 * reasons. The current algorithm is `d3-hierarchy.pack()` (Bertrand's circle
 * packing, Wang et al.). We considered an actual Voronoi treemap earlier;
 * bubble packing read more like the references we were chasing, so we switched.
 *
 * Reads `public/corpus-treemap/structure.json`, generates the brain silhouette
 * (used only as a decorative backdrop now — bubbles cluster inside it, not
 * clipped by it), then runs circle packing once for the root (11 top-level
 * categories) and once per parent that has children. Each drill-in lays out
 * children inside the parent's *open* circle — i.e., the size and position
 * the parent bubble has after it scales up into the modal target.
 *
 * Output: one JSON file per layout in `public/corpus-treemap/`:
 *   - voronoi-root.json          — 11 root bubbles
 *   - voronoi-<parent-id>.json   — children inside each parent's open bubble
 *
 * @module corpus-voronoi/layout-build
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hierarchy, pack } from 'd3-hierarchy';
import {
  forceSimulation,
  forceCollide,
  forceX,
  forceY,
} from 'd3-force';

// brain-shape.js is intentionally not imported — we dropped the brain backdrop.
// The file is kept in src/lib/corpus-voronoi/ for now in case we revisit the
// silhouette idea later; safe to delete if it doesn't get used by other work.

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const REPO_ROOT = join(__dirname, '..', '..', '..');
const STRUCTURE_PATH = join(
  REPO_ROOT,
  'public',
  'corpus-treemap',
  'structure.json',
);
const OUTPUT_DIR = join(REPO_ROOT, 'public', 'corpus-treemap');

// ---------- Configuration ----------

// Canvas coordinate space. Renderer scales via SVG viewBox.
const CANVAS_W = 1000;
const CANVAS_H = 700;

// Root cluster geometry: diameter and center of the bubble cluster. With the
// brain dropped, the cluster is centered in the canvas; force compaction
// (below) collapses any empty space at the cluster edge so the visible
// silhouette is the cluster's own outline.
const ROOT_CLUSTER_DIAMETER = 620;
const ROOT_CLUSTER_CX = 500;
const ROOT_CLUSTER_CY = 350;

// Padding between sibling bubbles, in pixel units. Very small — force
// compaction below pulls bubbles together aggressively, so any nonzero
// padding ends up as the visible gap.
const ROOT_PADDING = 1;
const CHILD_PADDING = 1;

// Force-compaction iteration count after the d3.pack() initial placement.
// More iterations = tighter packing; diminishing returns past ~400.
const COMPACT_ITERATIONS = 500;

// Modal target: when a parent bubble is opened, it scales+translates to a
// circle of this diameter centered here. Children pack inside.
const MODAL_DIAMETER = 540;
const MODAL_CX = 500;
const MODAL_CY = 350;

// ---------- Helpers ----------

/**
 * Pack circles into a tight cluster.
 *
 * Two-pass approach: first use `d3.pack()` to size each circle proportionally
 * to its value (gives us correct radii), then run a force simulation with
 * strong collision avoidance + gentle centering to compact the layout. Force
 * compaction closes the gaps `d3.pack()` leaves in its greedy placement.
 *
 * The cluster is centered at (clusterCx, clusterCy). The `clusterD` parameter
 * sets the *initial* diameter used for radius sizing; the final compacted
 * cluster ends up slightly smaller than clusterD because compaction shrinks
 * the dead space.
 */
function packCircles(items, clusterCx, clusterCy, clusterD, padding) {
  // d3-hierarchy descends through `children` when present. Strip nested
  // children so pack() treats each item as a leaf at depth 1 — otherwise we
  // get the grandchildren laid out instead.
  const flatItems = items.map(({ children, ...rest }) => ({
    ...rest,
    _hasChildren: Array.isArray(children) && children.length > 0,
  }));

  const root = hierarchy({ children: flatItems }).sum((d) => d.value || 0);

  // First pass: d3.pack to determine radii proportional to value.
  pack().size([clusterD, clusterD]).padding(0)(root);

  // Build force-sim nodes. Initial positions from d3.pack are already
  // approximately packed — force just compacts the gaps.
  const nodes = root.children.map((n) => ({
    id: n.data.id,
    label: n.data.label,
    value: n.data.value,
    color: n.data.color || null,
    isUnknown: !!n.data.isUnknown,
    hasChildren: !!n.data._hasChildren,
    x: n.x,
    y: n.y,
    r: n.r,
  }));

  // Force compaction. Strong collide for hard non-overlap; gentle x/y forces
  // toward the cluster center pull bubbles together until collision balances
  // the pull. Iterations: ~500 is overkill but cheap at this scale.
  const sim = forceSimulation(nodes)
    .force(
      'collide',
      forceCollide((d) => d.r + padding / 2)
        .strength(1)
        .iterations(4),
    )
    .force('x', forceX(clusterD / 2).strength(0.08))
    .force('y', forceY(clusterD / 2).strength(0.08))
    .stop();

  for (let i = 0; i < COMPACT_ITERATIONS; i++) sim.tick();

  // Recenter onto canvas coords. The simulation's "0,0" is the top-left of
  // the original clusterD x clusterD box; cluster ended up around the box
  // center, but compaction may have shifted things slightly. Recenter using
  // the actual centroid of the cluster (weighted by area).
  let totalArea = 0;
  let cxSum = 0;
  let cySum = 0;
  for (const n of nodes) {
    const a = Math.PI * n.r * n.r;
    totalArea += a;
    cxSum += n.x * a;
    cySum += n.y * a;
  }
  const actualCx = cxSum / totalArea;
  const actualCy = cySum / totalArea;
  const dx = clusterCx - actualCx;
  const dy = clusterCy - actualCy;

  return nodes.map((n) => ({
    ...n,
    x: n.x + dx,
    y: n.y + dy,
  }));
}

/**
 * Given a bubble in the root view, compute the affine transform that scales
 * and translates it to the modal target (centered, MODAL_DIAMETER).
 * Returns { openX, openY, openR, transform: { scale, tx, ty } }.
 *
 * The transform maps any point (x, y) in the root view to its open-state
 * position: (x*scale + tx, y*scale + ty). This is uniform scale (circles
 * remain circles).
 */
function computeOpenState(bubble) {
  const openR = MODAL_DIAMETER / 2;
  const scale = openR / bubble.r;
  const openX = MODAL_CX;
  const openY = MODAL_CY;
  const tx = openX - bubble.x * scale;
  const ty = openY - bubble.y * scale;
  return { openX, openY, openR, transform: { scale, tx, ty } };
}

/**
 * Sanity-check the layout: every bubble has a positive radius, areas roughly
 * proportional to data values.
 */
function verifyLayout(bubbles, label) {
  if (bubbles.length === 0) throw new Error(`[${label}] no bubbles produced`);
  for (const b of bubbles) {
    if (!Number.isFinite(b.r) || b.r <= 0) {
      throw new Error(`[${label}] bubble ${b.id} has bad radius (${b.r})`);
    }
  }
  // Area = π * r². With circle packing, sibling areas are exactly proportional
  // to values (the algorithm sets r = sqrt(value / π * scale)). Tiny rounding
  // tolerance only.
  const totalValue = bubbles.reduce((s, b) => s + b.value, 0);
  const totalArea = bubbles.reduce((s, b) => s + Math.PI * b.r * b.r, 0);
  let maxRelErr = 0;
  for (const b of bubbles) {
    const expected = b.value / totalValue;
    const actual = (Math.PI * b.r * b.r) / totalArea;
    const relErr = Math.abs(expected - actual) / expected;
    if (relErr > maxRelErr) maxRelErr = relErr;
  }
  return { maxRelErr };
}

// ---------- Main ----------

function main() {
  const t0 = Date.now();

  const structure = JSON.parse(readFileSync(STRUCTURE_PATH, 'utf8'));

  // Container metadata — no clip shape anymore. The renderer uses `viewBox`
  // for SVG scaling; the cluster centroid + radius are computed from the
  // packed bubbles themselves (in verifyLayout) for the modal background fade.
  const canvas = { viewBox: [0, 0, CANVAS_W, CANVAS_H] };

  mkdirSync(OUTPUT_DIR, { recursive: true });

  // --- Root layout ---
  const rootChildren = structure.children;
  console.log(`Building root layout (${rootChildren.length} bubbles)...`);
  const rootBubbles = packCircles(
    rootChildren,
    ROOT_CLUSTER_CX,
    ROOT_CLUSTER_CY,
    ROOT_CLUSTER_DIAMETER,
    ROOT_PADDING,
  );
  const rootCheck = verifyLayout(rootBubbles, 'root');
  const rootPath = join(OUTPUT_DIR, 'voronoi-root.json');
  writeFileSync(
    rootPath,
    JSON.stringify({ canvas, cells: rootBubbles }),
    'utf8',
  );
  console.log(
    `  wrote voronoi-root.json (max area err: ${(rootCheck.maxRelErr * 100).toFixed(2)}%)`,
  );

  // --- Drill-in layouts ---
  let childCount = 0;
  for (let i = 0; i < rootChildren.length; i++) {
    const parent = rootChildren[i];
    if (!parent.children || parent.children.length === 0) continue;

    const rootBubble = rootBubbles.find((b) => b.id === parent.id);
    if (!rootBubble) {
      throw new Error(`No root bubble for parent "${parent.id}"`);
    }

    const open = computeOpenState(rootBubble);

    console.log(
      `Building ${parent.id} modal layout (${parent.children.length} bubbles)...`,
    );

    // Children inherit parent color (structure.json has no per-child colors).
    const childrenWithColor = parent.children.map((c) => ({
      ...c,
      color: c.color || parent.color || null,
    }));
    const childBubbles = packCircles(
      childrenWithColor,
      open.openX,
      open.openY,
      open.openR * 2, // packCircles takes diameter
      CHILD_PADDING,
    );
    const check = verifyLayout(childBubbles, parent.id);

    const path = join(OUTPUT_DIR, `voronoi-${parent.id}.json`);
    writeFileSync(
      path,
      JSON.stringify({
        canvas,
        parent: {
          id: parent.id,
          label: parent.label,
          color: parent.color || null,
          value: parent.value,
          x: rootBubble.x,
          y: rootBubble.y,
          r: rootBubble.r,
          openX: open.openX,
          openY: open.openY,
          openR: open.openR,
          transform: open.transform,
        },
        cells: childBubbles,
      }),
      'utf8',
    );
    console.log(
      `  wrote voronoi-${parent.id}.json (max area err: ${(check.maxRelErr * 100).toFixed(2)}%)`,
    );
    childCount++;
  }

  const dt = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(
    `\nDone. ${1 + childCount} layouts written to ${OUTPUT_DIR} in ${dt}s.`,
  );
}

main();

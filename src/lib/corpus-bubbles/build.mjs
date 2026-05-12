#!/usr/bin/env node
/**
 * Precompute bubble-pack layouts for the corpus-bubbles figure.
 *
 * Two layout modes:
 *
 *   - **Root cluster (`buildRoot`)** — runs `d3.pack()` to get radii
 *     proportional to value, then runs a `d3-force` simulation with strong
 *     collision avoidance + gentle centering to close the gaps the greedy
 *     pack placement leaves behind. After compaction, computes the smallest
 *     enclosing circle of the cluster (`d3.packEnclose`) and saves it as
 *     the visible container.
 *
 *   - **Drill-in (`buildDrillIn`)** — runs `d3.pack()` alone inside the
 *     parent's open circle. Children come out tangent to each other and
 *     tangent to the parent's boundary (this is what `d3.pack` guarantees
 *     when given a bounding circle). No force compaction — that would pull
 *     children inward and leave a visible gap between them and the parent.
 *
 * Algorithm history: earlier iterations of this figure used
 * `d3-voronoi-treemap` clipped to a brain silhouette. Both the Voronoi
 * algorithm and the brain shape were dropped after iteration; bubble packing
 * read closer to the user's visual references and the algorithm is simpler.
 *
 * Output: one JSON file per layout in `public/corpus-bubbles/`:
 *   - `root.json`          — 11 root bubbles + container circle
 *   - `<parent-id>.json`   — children inscribed in parent's open circle
 *
 * @module corpus-bubbles/build
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hierarchy, pack, packEnclose } from 'd3-hierarchy';
import { forceSimulation, forceCollide, forceX, forceY } from 'd3-force';

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

// Canvas coordinate space. Renderer scales via SVG viewBox.
const CANVAS_W = 1000;
const CANVAS_H = 700;

// Root cluster: bubble pack initial diameter used for sizing the bubbles
// proportionally to value. Force compaction below shrinks the effective
// extent and `packEnclose` finds the actual container radius.
const ROOT_INITIAL_DIAMETER = 620;
const ROOT_CX = 500;
const ROOT_CY = 350;

// Padding between sibling bubbles (passed to `d3.pack().padding(...)` and as
// extra radius added in `forceCollide`).
const ROOT_PADDING = 2;
const CHILD_PADDING = 1;

// Force-compaction iteration count for the root. 500 is overkill but cheap.
const COMPACT_ITERATIONS = 500;

// Modal open state: when a parent bubble is opened, it scales+translates to
// a circle of this diameter centered here. Children pack inscribed inside.
const MODAL_DIAMETER = 540;
const MODAL_CX = 500;
const MODAL_CY = 350;

// Color palette override. Keyed by category id from structure.json. Applied
// at build time so structure.json (used by the older /corpus treemap) stays
// untouched during staging. Move into structure.json at Phase 7 swap if we
// keep these colors.
//
// First 7 entries are sampled from the user's reference palette (a muted,
// slightly desaturated set used in an information-design poster). The last
// 4 (legal, transcripts, synthetic, unknown) are derived to round out the
// 11 categories while staying within the same warm/muted feel.
const PALETTE = {
  web: '#809B57',          // sage green
  logic: '#7B5567',        // plum
  academic: '#5BA7A3',     // teal
  books: '#E2A82B',        // gold
  forums: '#8E2A3A',       // wine
  wiki: '#C5B746',         // pale olive
  multilingual: '#E29487', // coral
  legal: '#6F8088',        // cool gray-blue (derived)
  transcripts: '#B57480',  // muted rose (derived)
  synthetic: '#A8B570',    // light sage-yellow (derived)
  unknown: '#383838',      // charcoal
};

function applyPalette(item) {
  return { ...item, color: PALETTE[item.id] || item.color };
}

// ---------- Helpers ----------

/**
 * Build a `d3.hierarchy` from a flat list. Strips nested `children` so
 * `pack()` treats each item as a leaf at depth 1, and captures `hasChildren`
 * onto each leaf so the renderer can show drill-in affordances.
 */
function makeHierarchy(items) {
  const flat = items.map(({ children, ...rest }) => ({
    ...rest,
    _hasChildren: Array.isArray(children) && children.length > 0,
  }));
  return hierarchy({ children: flat }).sum((d) => d.value || 0);
}

/**
 * Convert a d3.hierarchy leaf node into a plain bubble object for JSON.
 * Preserves the original data fields (description, bullets, screenshot,
 * etc.) so the renderer can show panel content without a separate lookup.
 */
function nodeToBubble(node) {
  const d = node.data;
  // Skip d3-hierarchy's internal field plus the staging flag.
  // eslint-disable-next-line no-unused-vars
  const { _hasChildren, children, ...rest } = d;
  return {
    ...rest,
    color: d.color || null,
    isUnknown: !!d.isUnknown,
    hasChildren: !!_hasChildren,
    x: node.x,
    y: node.y,
    r: node.r,
  };
}

/**
 * Root cluster: pack bubbles proportionally, then force-compact, then find
 * the smallest enclosing circle to use as the visible container.
 */
function buildRoot(items, cx, cy, initialDiameter, padding) {
  const root = makeHierarchy(items);

  // Initial pack — produces value-proportional radii. The size sets the
  // overall scale; the actual cluster extent comes out of compaction.
  pack().size([initialDiameter, initialDiameter]).padding(padding)(root);

  const nodes = root.children.map((n) => ({
    ...nodeToBubble(n),
    // Force sim expects mutable x, y; copy them so the hierarchy stays clean.
    x: n.x,
    y: n.y,
  }));

  // Force compaction: collide with extra padding pushes bubbles apart just
  // enough to avoid overlap; x/y forces toward the cluster center pull them
  // together until collision balances the pull. Result: tight pack.
  const sim = forceSimulation(nodes)
    .force(
      'collide',
      forceCollide((d) => d.r + padding / 2)
        .strength(1)
        .iterations(4),
    )
    .force('x', forceX(initialDiameter / 2).strength(0.1))
    .force('y', forceY(initialDiameter / 2).strength(0.1))
    .stop();
  for (let i = 0; i < COMPACT_ITERATIONS; i++) sim.tick();

  // Smallest enclosing circle of the compacted cluster — this is the
  // container we'll render behind the bubbles.
  const enclose = packEnclose(nodes);

  // Translate so the enclosing circle lands at (cx, cy).
  const dx = cx - enclose.x;
  const dy = cy - enclose.y;

  return {
    container: { x: cx, y: cy, r: enclose.r + padding },
    cells: nodes.map((n) => ({ ...n, x: n.x + dx, y: n.y + dy })),
  };
}

/**
 * Drill-in: pack children inscribed in a circle of the given diameter,
 * centered at (cx, cy). No force compaction — `d3.pack()` already places
 * children tangent to the bounding circle, which is what we want for the
 * modal-open state.
 */
function buildDrillIn(items, cx, cy, diameter, padding) {
  const root = makeHierarchy(items);
  pack().size([diameter, diameter]).padding(padding)(root);

  // Translate from pack's local origin (0..diameter) to canvas coords.
  const dx = cx - diameter / 2;
  const dy = cy - diameter / 2;

  return root.children.map((n) => ({
    ...nodeToBubble(n),
    x: n.x + dx,
    y: n.y + dy,
  }));
}

/**
 * Compute the affine transform from a parent's root-state circle to its
 * open-state circle. (Uniform scale + translate; a circle stays a circle.)
 */
function computeOpenState(parentBubble) {
  const openR = MODAL_DIAMETER / 2;
  const scale = openR / parentBubble.r;
  const tx = MODAL_CX - parentBubble.x * scale;
  const ty = MODAL_CY - parentBubble.y * scale;
  return {
    openX: MODAL_CX,
    openY: MODAL_CY,
    openR,
    transform: { scale, tx, ty },
  };
}

/**
 * Lightweight sanity check: every bubble has a positive radius, and π·r² is
 * (within rounding) proportional to value.
 */
function verify(bubbles, label) {
  if (bubbles.length === 0) throw new Error(`[${label}] no bubbles produced`);
  for (const b of bubbles) {
    if (!Number.isFinite(b.r) || b.r <= 0) {
      throw new Error(`[${label}] bubble ${b.id} has bad radius ${b.r}`);
    }
  }
  const totalValue = bubbles.reduce((s, b) => s + b.value, 0);
  const totalArea = bubbles.reduce((s, b) => s + Math.PI * b.r * b.r, 0);
  let maxErr = 0;
  for (const b of bubbles) {
    const expected = b.value / totalValue;
    const actual = (Math.PI * b.r * b.r) / totalArea;
    const err = Math.abs(expected - actual) / expected;
    if (err > maxErr) maxErr = err;
  }
  return maxErr;
}

// ---------- Main ----------

function main() {
  const t0 = Date.now();
  const structure = JSON.parse(readFileSync(STRUCTURE_PATH, 'utf8'));
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const canvas = { viewBox: [0, 0, CANVAS_W, CANVAS_H] };

  // --- Root ---
  const rootChildren = structure.children.map(applyPalette);
  console.log(`Building root (${rootChildren.length} bubbles)...`);
  const { container, cells: rootCells } = buildRoot(
    rootChildren,
    ROOT_CX,
    ROOT_CY,
    ROOT_INITIAL_DIAMETER,
    ROOT_PADDING,
  );
  const rootErr = verify(rootCells, 'root');
  writeFileSync(
    join(OUTPUT_DIR, 'root.json'),
    JSON.stringify({ canvas, container, cells: rootCells }),
    'utf8',
  );
  console.log(
    `  wrote root.json — container r=${container.r.toFixed(1)}, area err ${(rootErr * 100).toFixed(2)}%`,
  );

  // --- Drill-ins ---
  let drilledCount = 0;
  for (const parent of rootChildren) {
    if (!parent.children || parent.children.length === 0) continue;

    const rootBubble = rootCells.find((b) => b.id === parent.id);
    if (!rootBubble) {
      throw new Error(`No root bubble for parent "${parent.id}"`);
    }
    const open = computeOpenState(rootBubble);

    console.log(
      `Building ${parent.id} drill-in (${parent.children.length} children)...`,
    );

    // Children inherit the parent's (paletted) color. structure.json
    // doesn't carry per-child colors.
    const colored = parent.children.map((c) => ({
      ...c,
      color: c.color || parent.color || null,
    }));
    const childCells = buildDrillIn(
      colored,
      open.openX,
      open.openY,
      open.openR * 2,
      CHILD_PADDING,
    );
    const err = verify(childCells, parent.id);

    // Bake panel content into the drill-in JSON. Keeps the renderer
    // self-contained — it only needs one JSON per modal state, with all
    // the data needed to draw the bubbles AND the side panel.
    writeFileSync(
      join(OUTPUT_DIR, `${parent.id}.json`),
      JSON.stringify({
        canvas,
        parent: {
          id: parent.id,
          label: parent.label,
          color: parent.color || null,
          value: parent.value,
          description: parent.description || '',
          bullets: parent.bullets || [],
          screenshot: parent.screenshot || null,
          screenshotCaption: parent.screenshotCaption || '',
          isUnknown: !!parent.isUnknown,
          x: rootBubble.x,
          y: rootBubble.y,
          r: rootBubble.r,
          openX: open.openX,
          openY: open.openY,
          openR: open.openR,
          transform: open.transform,
        },
        cells: childCells.map((c) => ({
          ...c,
          description: c.description || '',
          bullets: c.bullets || [],
          screenshot: c.screenshot || null,
          screenshotCaption: c.screenshotCaption || '',
        })),
      }),
      'utf8',
    );
    console.log(
      `  wrote ${parent.id}.json — area err ${(err * 100).toFixed(2)}%`,
    );
    drilledCount++;
  }

  const dt = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(
    `\nDone. ${1 + drilledCount} layouts written to ${OUTPUT_DIR} in ${dt}s.`,
  );
}

main();

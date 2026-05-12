# Corpus Voronoi — Design Notes

Living design doc for the bubble-pack redesign of the AI training-data corpus
visualization. Written so a fresh Claude session can resume the work without
re-deriving decisions.

**Note on naming:** the directory is `corpus-voronoi` for historical reasons.
Earlier iterations used a Voronoi treemap (`d3-voronoi-treemap`) and later a
brain-shaped backdrop. Both were dropped — bubble packing with no container
shape read closer to the visual references Irwin pointed at, and the algorithm
is simpler. Directory + file names were kept to avoid touching every path.
CSS class prefix is `cv-` ("corpus visualization"), algorithm-agnostic. The
staging URL `/corpus-brain` is also legacy; it can be renamed at Phase 7 swap
time.

## Goal

Replace the squarified treemap at `/corpus` with a tight bubble cluster
(circles sized by token share, force-compacted) of AI training-data
categories. Drill-in is a modal overlay: clicking a bubble dims and blurs
the root cluster in the background while the selected bubble zooms to canvas
center with its children packed inside.

## Why this exists

The current treemap (`src/components/corpus-treemap/CorpusTreemap.astro`) works
well for data fidelity but reads as a generic dashboard chart. The bubble-pack
treatment is more distinctive — categories read as discrete units whose sizes
are immediately legible, and the cluster has a clearer figure/ground than a
filled-in rectangle of tiles. The drill-in already exists in the squarified
version; the new component preserves it but upgrades the visual treatment and
adds rubbery modal-overlay transitions.

## Architecture

Three layers, matching the established pattern from `src/components/brain-3d/`
and the existing corpus-treemap:

1. **Pure-JS lib** (`src/lib/corpus-voronoi/`) — no DOM, no rendering library.
   Unit-tested.
2. **Renderer** (`src/components/corpus-voronoi/CorpusVoronoi.astro`) — owns the
   SVG surface. Consumes precomputed polygon data.
3. **Astro page** (`src/pages/corpus.astro` updated, or new URL) — wraps the
   component with header, footer, sources.

### Build-time precomputation

Bubble packing (`d3-hierarchy.pack()`) is fast enough to run at request time,
but we precompute at build time anyway for consistency and so the runtime
ships no algorithm code. The script writes one JSON file per layout (root +
each parent's drill-in) to `public/corpus-treemap/`.

This gives:

- Zero runtime algorithm cost
- Zero new client-side dependencies
- `d3-hierarchy` is a devDependency only
- Determinism (same data → same layout)

Trade-off: when `structure.json` changes, the script must re-run. Wired into
`npm run build` as a prebuild step so it's automatic. Local dev uses a manual
`npm run voronoi:build` if iterating on data.

### File layout

```
src/lib/corpus-voronoi/
  brain-shape.js              # generates convex brain polygon (backdrop)
  layout-build.mjs            # Node entry: runs d3.pack(), writes JSON layouts
  resample.js                 # polygon utility helpers (centroid, area, perimeter)
                              #   — kept from the Voronoi era; utilities still useful

src/components/corpus-voronoi/
  DESIGN.md                   # this file
  CorpusVoronoi.astro         # shell — SVG render, drill-in, animation, panel

src/pages/
  corpus-brain.astro          # staging URL during rollout
  corpus.astro                # swap target after final approval

public/corpus-treemap/
  voronoi-root.json           # 11 root bubbles + brain backdrop
  voronoi-<id>.json           # one per parent — children inside parent's
                              # open-state bubble

test/corpus-voronoi/
  brain-shape.test.js         # convexity, determinism, sizing (22 tests)
  resample.test.js            # polygon utility tests (17 tests)
```

## Brain shape (legacy)

The brain silhouette was originally the container/clip shape for the layout.
After iterating, the brain backdrop made the cluster look small relative to
the surrounding empty silhouette area; the user dropped the backdrop in
favor of the cluster alone. `src/lib/corpus-voronoi/brain-shape.js` is kept
in case we revisit a silhouette-as-backdrop variant, but neither the build
script nor the renderer reference it. Safe to delete during Phase 7 cleanup.

The remaining brain-related content below is preserved for reference.

Left-facing lateral profile. Frontal lobe on the left, occipital lobe on the
right.

### Silhouette generation

Procedural, deterministic. `brain-shape.js` exports:

```js
brainLateralPolygon({ width, height, seed = 1, lumpiness = 0.015 })
  // → Array<[x, y]> of points forming a convex polygon
```

The convex polygon is built from 8-12 Bezier control points sampled into ~40
final polygon points. Features:

- **Frontal lobe bulge** at front-left (top-left quadrant rounded outward)
- **Occipital lobe bulge** at back-right (bottom-right rounded outward, slightly
  lower than frontal)
- **Smooth taper** at the bottom-front (where the temporal lobe would drop, but
  we stay convex)
- **Smooth taper** at the bottom-back (where the cerebellum would sit, but we
  stay convex)
- **Very light boundary undulation** — `lumpiness` parameter is small by default.
  Anatomical lateral brains are mostly smooth at the silhouette; gyri are
  surface features, not outline features.

Convexity is enforced by the generator and asserted by a unit test. The
algorithm `d3-voronoi-treemap` requires this.

### Anatomical overlays

Removed. Earlier drafts added a Sylvian fissure stroke and a cerebellum line
on top of the cells; both were dropped because they crossed cell boundaries
(introducing visual noise that competed with the data), added ambiguity
("is this line meaningful?"), and weren't needed once the cells fill the
silhouette — the brain reads as a brain from the outline + organic cell
tessellation alone. The brain stem was also dropped earlier in planning for
the same minimalist reason.

## Bubble-pack layout

Two-pass: `d3-hierarchy.pack()` for radii proportional to value, then
`d3-force` compaction to close the gaps the greedy `d3.pack` placement
leaves behind. Without force compaction the cluster has visible empty
space between bubbles; with it, the cluster is tight.

### Algorithm parameters

- **Root cluster initial diameter:** 620 px, centered at (500, 350) in the
  1000×700 canvas. Compaction usually shrinks the effective extent slightly.
- **Padding:** 1 px between sibling bubbles. Force compaction makes any
  larger padding read as a visible gap.
- **Force compaction:** 500 iterations of `forceCollide` (strength 1, 4
  internal iterations) + `forceX` / `forceY` at strength 0.08 toward the
  cluster center. Run at build time, not runtime.
- **Modal target:** parent bubble opens to a 540-px-diameter circle centered
  at canvas center (500, 350). Children pack inside (same two-pass).

### Output JSON shape

```jsonc
// voronoi-root.json
{
  "canvas": { "viewBox": [0, 0, 1000, 700] },
  "cells": [
    {
      "id": "web",
      "label": "The Web",
      "value": 38,
      "color": "#...",
      "x": 500, "y": 350,
      "r": 120,
      "hasChildren": true
    },
    ...
  ]
}

// voronoi-<parent-id>.json
{
  "canvas": { "viewBox": [0, 0, 1000, 700] },
  "parent": {
    "id": "web",
    "label": "The Web",
    "color": "#...",
    "value": 38,
    "x": 500, "y": 350, "r": 120,      // position in root view
    "openX": 500, "openY": 350,
    "openR": 270,                       // position when modal is open
    "transform": {                      // affine: rootPoint → openPoint
      "scale": s, "tx": tx, "ty": ty
    }
  },
  "cells": [
    // children, packed inside parent.openR circle
    { "id": ..., "label": ..., "x": ..., "y": ..., "r": ..., ... },
    ...
  ]
}
```

## Drill-in: modal overlay

Drill-in is treated as a **modal overlay**, not a state replacement. The root
brain stays visible behind the modal in a heavily dimmed and blurred state.
Clicking a bubble zooms it into the modal position (scale + translate — a
circle stays a circle at any scale). Children appear inside the zoomed-up
bubble.

This is the simplest possible drill-in pattern: the parent bubble's animation
is a pure affine transform, the background context is preserved, and the
children are just smaller circles packed inside the larger one.

### Visual states

**Root state:**

- 11 tightly packed colored bubbles on the page background — no container
  shape behind them
- All bubbles fully saturated and interactive (hover, click)

**Modal-open state:**

- Root cluster still visible behind, but heavily dimmed and blurred
  (`grayscale(1) blur(6px)` at ~18% opacity). With no container shape, the
  blurred cluster itself is the only background context.
- Clicked parent bubble, in its original color, scaled up to a circle of
  diameter 540 centered at canvas center
- Inside the scaled-up parent: children bubbles (packed at build time
  inside the parent's open circle)
- Panel content (description, bullets, screenshot) floating on the right
  side of the canvas as a near-white card
- Close affordance: small × button + ESC key
- Background bubbles are non-interactive (clicks ignored; must close first)

### Modal geometry

Computed at build time. Each parent's "open circle" is a fixed-size circle
(diameter 540) centered at canvas center (500, 350). The transform from root
position to open position is recorded for the animation. The children bubbles
are packed inside the open circle.

Adjustable constants in `layout-build.mjs`:
`MODAL_DIAMETER`, `MODAL_CX`, `MODAL_CY`.

### Animation

Three phases, ~1.0s total, spring-out easing on the hero phase:

1. **Background dims + blurs** (250ms, ease-out). All non-selected bubbles
   and the brain backdrop get `filter: grayscale(1) blur(6px)` at 18%
   opacity. Single CSS transition.
2. **Selected bubble zooms** (550ms, `cubic-bezier(0.34, 1.56, 0.64, 1)`).
   CSS transform on the bubble's `<g>`: translate + uniform scale from its
   root position to its open position. Spring-out overshoot gives the rubbery
   feel. GPU-accelerated.
3. **Children + panel pop in** (400ms each, staggered 40ms, easeOutBack).
   Each child bubble starts at scale 0 at its own center, scales up. Panel
   card fades + slides in from the right.

### Drill-out (close)

Reverse, faster (~700ms total):

1. Children + panel shrink and fade (200ms).
2. Selected bubble un-zooms back to its root position (450ms, easeOutBack).
3. Background un-dims (250ms, ease-out, overlaps with step 2).

Triggered by the × button or ESC key. Background bubbles are non-interactive
during modal state — clicks ignored.

### Easing

`easing.js` exports `easeOutBack`, `easeInBack`, `easeInOut`, etc. as pure
functions. Default for "rubbery" feel:

```js
const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
```

If `easeOutBack` doesn't feel right after tuning, we upgrade to a true
physics-based spring solver (mass / tension / friction). About 30 lines more.

### Animator

`animate.js` exports `animate({ duration, easing, onUpdate, onComplete })`
backed by `requestAnimationFrame`. No dependencies. Cancellable.

### Reduced motion

`prefers-reduced-motion: reduce` → 200ms crossfade, no scale/morph.

## Side panel

The panel content (description, bullets, screenshot, percentage) is rendered
**inside the modal**, alongside the zoomed-up parent cell shape with its
children. There is no persistent sidebar — the panel only exists when a cell
is open.

Layout inside the modal:

- Left ~60% of modal area: the zoomed parent cell with children inside
- Right ~36% of modal area: panel content (color swatch, title, percentage,
  description, bullets, screenshot)
- Top-right: small × close button

The panel content carries over from the current treemap's `CorpusTreemap.astro`:
title, percentage, description, bullets, screenshot, child list (with the
child list redesigned since children are now visible in the modal itself —
likely omitted, or replaced with hover hints).

The current treemap's child-card grid is no longer needed since children
appear as cells in the modal. The screenshot moves up in the visual hierarchy
since it's the main descriptive artifact.

## Labels

**None on the cells.** Matches the reference image's clean look, and sidesteps
the cell-label-placement problem in irregular Voronoi polygons.

Information surfaces in three places:

- **Hover/focus tooltip** on each cell — shows label + percentage, positioned
  near cursor / cell centroid
- **Side panel** — full info on click
- **Color** — categories remain color-coded as in the current treemap (each
  category keeps its distinct color, e.g. red for Web, blue for Code), so the
  brain itself is read as a multi-colored cluster

## Sizing & responsive behavior

- **Desktop:** single full-width canvas containing the brain centered with
  breathing room. No persistent sidebar — the modal handles drill-in. Brain
  silhouette occupies ~80% of the canvas area.
- **Mobile (<700px):** brain fills the viewport. Modal opens as a full-screen
  overlay with cells on top and panel content scrolling below.
- **Brain aspect ratio:** ~1.4:1 (width:height), matching lateral brain
  proportions. SVG `viewBox` adapts; the brain polygon is scaled to fit.
- **ResizeObserver:** detects container size changes. Polygons are precomputed
  in the 1000×700 build-time coordinate system; SVG viewBox handles scaling
  to the current viewport at render time. No layout recomputation on resize.

## Source attribution

Carries over unchanged from `structure.json`. The Voronoi treatment is a visual
transformation only; no new claims to source. The build script gets a header
comment documenting:

- Voronoi treemap algorithm: Balzer, M. & Deussen, O. (2005). "Voronoi
  Treemaps." IEEE Symposium on Information Visualization.
- Implementation: `d3-voronoi-treemap` by Franck Lebas (MIT license).

Sources block under the figure stays as-is (The Pile, Dolma v1.7, Llama 3.1
Tech Report, FMTI 2025).

## Conventions

- **No new runtime dependencies.** `d3-voronoi-treemap` + `d3-weighted-voronoi`
  go in devDependencies only. Runtime ships precomputed JSON.
- **Modern CSS only** — `light-dark()`, logical properties, CSS nesting.
- **Pure JS lib has no DOM imports.** All DOM work in the Astro shell.
- **Determinism.** Seeded random everywhere. Same build → same brain.
- **Test what matters.** Convexity of the brain polygon, area fidelity of the
  Voronoi cells (within 1-2% of target after convergence), point-count match
  for morphable polygons.

## Rollout

Ship the new figure at **`/corpus-brain`** first so it can be compared
side-by-side with the existing `/corpus` treemap. Once it's verified visually and the user is happy, swap `/corpus` to
the new component and delete the old `CorpusTreemap.astro` / `corpus-treemap/`
lib files in a follow-up commit.

The old data file `public/corpus-treemap/structure.json` is reused as-is — no
data migration. The new precomputed JSON files live in the same
`public/corpus-treemap/` directory.

## Phases

- **Phase 1 — Brain shape lib. Done.** `brain-shape.js` exports
  `brainLateralPolygon`, `isConvex`, `mulberry32`, `polygonToPointsAttr`. 22
  tests covering convexity, determinism, sizing, lateral orientation, and
  anatomical bulges. Decorative overlays (Sylvian fissure, cerebellum line)
  ripped out.
- **Phase 2 — Build script. Done.** `layout-build.mjs` runs `d3.pack()` for
  the root cluster (11 bubbles inside the brain) and for each parent (children
  inside the parent's open-state circle). Each drill-in records the affine
  transform from the root bubble's position to its open position.
  `npm run voronoi:build` writes 12 layout files in ~30ms. Children inherit
  parent color. Migration from `d3-voronoi-treemap` to bubble packing
  completed; old polygon-based JSON regenerated as circle-based.
- **Phase 3 — Static render of root. Done.** `CorpusVoronoi.astro` renders
  the brain backdrop + 11 root bubbles from `voronoi-root.json`. New page at
  `/corpus-brain`.
- **Phase 4 — Modal drill-in (no animation).** Click bubble → load
  `voronoi-<id>.json` → render the modal state (brain dimmed + blurred,
  parent bubble at open position with children inside, panel content card
  on the right, × close button). Crossfade between root and modal for now.
  Wire ESC + × close.
- **Phase 5 — Rubbery animation.** Three-phase open/close:
  1. Background dims + blurs (250ms ease-out)
  2. Selected bubble scales+translates to open position (550ms
     `cubic-bezier(0.34, 1.56, 0.64, 1)` — CSS transform on the `<g>`)
  3. Children + panel pop in (400ms staggered 40ms easeOutBack)
  Close reverses, ~700ms total. Pure CSS transitions where possible.
- **Phase 6 — Mobile + reduced-motion.** Responsive sizing, mobile modal as
  full-screen overlay, `prefers-reduced-motion: reduce` → 200ms crossfade
  with no scale/translate.
- **Phase 7 — Swap `/corpus`.** Update `src/pages/corpus.astro` to use
  `CorpusVoronoi`. Delete old `CorpusTreemap` files. Single commit.

## Decisions made during planning

- **Color palette:** keep multi-color (each category its existing distinct
  color). Rationale: reads as a chart-of-the-brain rather than a generic
  anatomical illustration; preserves categorical legibility.
- **Staging URL:** `/corpus-brain`.
- **Brain stem:** omitted. Cleaner silhouette.
- **Anatomical overlays (Sylvian, cerebellum line):** dropped. Silhouette +
  cells communicate "brain" without chart junk over the data.
- **Canvas fill:** breathing room (~80% of canvas), centered, not edge-to-edge.
- **Hover behavior:** tooltip on hover/focus shows label + percentage near the
  cell. Full info on click in the modal.
- **Asset path:** keep precomputed JSON in `public/corpus-treemap/` for
  stability (screenshot paths in `structure.json` already reference this
  location). Optional cleanup to rename to `public/corpus/` deferred until
  after the old treemap component is deleted.
- **Drill-in pattern:** modal overlay, not state replacement. Root brain stays
  visible behind the modal in a heavily dimmed and blurred state. Parent
  bubble scales+translates to open position (circle stays a circle).
- **Modal size:** parent bubble expands to a 540-diameter circle centered at
  canvas center. Panel card floats on the right of the canvas, partially
  overlapping the blurred background.
- **Layout algorithm:** `d3-hierarchy.pack()` for radii + `d3-force`
  compaction for tightness. Earlier iterations used `d3-voronoi-treemap` and
  later vanilla `d3.pack()` alone; force compaction was added because pack
  alone left visible gaps.
- **Container shape:** none. The brain silhouette was the original container
  but made the cluster look loose against the empty backdrop area; dropped
  in favor of just rendering the bubble cluster on the page background.
  Phase 7 may rename `/corpus-brain` → `/corpus-bubbles` or similar to
  reflect this.
- **Close affordances:** dedicated × button + ESC key. (No click-outside; the
  background is not interactive during modal.)
- **Background clicks during modal:** ignored. User must close first before
  opening a different cell. Simplest logic; avoids mid-animation transitions.
- **Panel location:** inside the modal alongside the cells, not as a
  persistent sidebar. Self-contained — everything about the selected category
  is in one place.

## Open questions

None blocking Phase 1. Add here as they come up.

## Constraints to remember

- **Never write as Irwin** (project CLAUDE.md). The on-page copy "What does an
  AI model actually train on?" carries over from the current treemap and was
  written by Irwin; do not reword.
- **Source Transparency Protocol applies** to any text on the page that makes a
  source claim. Current treemap's sources block already complies.
- **Don't touch `publish.sh`** — flagged legacy.
- **No auto-commit.** Irwin reviews before push.

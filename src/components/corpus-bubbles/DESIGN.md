# Corpus Bubbles — Design Notes

Living design doc for the bubble-pack visualization of AI training data.
Written so a fresh Claude session can resume the work without re-deriving
decisions.

## Goal

Replace the squarified treemap at `/corpus` with a tight cluster of bubbles
representing AI pre-training corpus categories. Each bubble's area is
proportional to its share of training tokens. Clicking a bubble opens a
modal-overlay drill-in: the root cluster dims and blurs into the background
while the selected bubble zooms to canvas center with its children packed
inside.

## Why this exists

The current treemap (`src/components/corpus-treemap/CorpusTreemap.astro`)
reads as a generic dashboard chart. Bubbles are more distinctive — categories
read as discrete units, sizes are immediately legible from area, and the
cluster has a clearer figure/ground than filled-in rectangles. The drill-in
already exists in the treemap; the new component preserves it but upgrades
the visual treatment and adds rubbery modal-overlay transitions.

## History (brief)

This is the third iteration. The first used `d3-voronoi-treemap` clipped to a
brain silhouette; the second kept the brain as a backdrop with bubbles
inside; the third (current) drops the brain shape entirely. The bubble
cluster on its own reads as the figure, with a thin container circle hugging
the cluster from its smallest enclosing circle.

## Architecture

Three layers, matching the established pattern from
`src/components/brain-3d/`:

1. **Pure-JS build script** (`src/lib/corpus-bubbles/build.mjs`) — runs at
   build time via `npm run bubbles:build`. Reads `structure.json`, computes
   bubble layouts, writes JSON.
2. **Renderer** (`src/components/corpus-bubbles/CorpusBubbles.astro`) — owns
   the SVG surface. Consumes precomputed JSON.
3. **Astro page** (`src/pages/corpus-bubbles.astro`) — wraps the component
   with header, nav, footer.

### File layout

```
src/lib/corpus-bubbles/
  build.mjs                    # Node entry: runs d3.pack() + d3-force, writes JSON

src/components/corpus-bubbles/
  DESIGN.md                    # this file
  CorpusBubbles.astro          # shell — SVG render, drill-in, animation, panel

src/pages/
  corpus-bubbles.astro         # staging URL during rollout (/corpus-bubbles)
  corpus.astro                 # swap target after final approval

public/corpus-bubbles/
  root.json                    # 11 root bubbles + container circle
  <parent-id>.json             # one per parent — children inscribed in
                               # parent's open-state circle

public/corpus-treemap/
  structure.json               # source-of-truth data (kept at original path
                               # because screenshot paths reference it)
  screenshots/                 # category screenshot images
  thumbs/                      # thumbnails

src/components/corpus-treemap/ # OLD squarified treemap, still live on /corpus
                               # until Phase 7 swap. Do not edit.
```

CSS class prefix: `cb-` (corpus-bubbles).

### Build-time precomputation

Bubble packing is fast enough to run at request time, but we precompute at
build time anyway so the runtime ships no algorithm code and the layout is
deterministic across deploys.

Trade-off: when `structure.json` changes, the script must re-run. Wired into
`npm run build` as a prebuild step (TODO; currently manual via
`npm run bubbles:build`).

## Layout algorithm

Two-mode packer in `build.mjs`:

### Root cluster (`buildRoot`)

1. **`d3.pack()`** sizes each bubble so `π·r²` is proportional to value.
2. **`d3-force` compaction** (500 iterations) with strong collision avoidance
   + gentle x/y centering forces. Closes the gaps that `d3.pack`'s greedy
   placement leaves behind.
3. **`d3.packEnclose`** computes the smallest enclosing circle of the
   compacted cluster. This circle is the visible container.
4. Translate the cluster so the enclosing circle lands at canvas center.

### Drill-in (`buildDrillIn`)

1. **`d3.pack()`** alone, inside a circle of diameter = parent's `openR * 2`.
   `d3.pack` places children tangent to each other and tangent to the
   bounding circle — exactly what we want for the modal-open state.
2. **No force compaction.** Force compaction here pulls children inward
   away from the parent boundary, leaving a visible gap. (This was a real
   bug in an earlier iteration.)

### Modal open state

When a parent bubble is clicked, it scales+translates from its root position
to a circle of `MODAL_DIAMETER` (540) centered at canvas center. The
transform is precomputed at build time:

```js
scale = MODAL_DIAMETER / 2 / parent.r
tx = MODAL_CX - parent.x * scale
ty = MODAL_CY - parent.y * scale
```

A circle stays a circle under uniform scale, so the parent bubble's identity
is preserved across the zoom.

### Output JSON shape

```jsonc
// root.json
{
  "canvas": { "viewBox": [0, 0, 1000, 700] },
  "container": { "x": 500, "y": 350, "r": 280 },
  "cells": [
    {
      "id": "web",
      "label": "The Web",
      "value": 38,
      "color": "#3B6DB4",
      "x": 500, "y": 350, "r": 120,
      "hasChildren": true
    },
    ...
  ]
}

// <parent-id>.json
{
  "canvas": { "viewBox": [0, 0, 1000, 700] },
  "parent": {
    "id": "web",
    "label": "The Web",
    "color": "#3B6DB4",
    "value": 38,
    "x": 500, "y": 350, "r": 120,        // position in root
    "openX": 500, "openY": 350,
    "openR": 270,                          // position in modal
    "transform": {                         // affine: root → open
      "scale": s, "tx": tx, "ty": ty
    }
  },
  "cells": [
    // children, inscribed in the parent's open circle
    { "id": ..., "label": ..., "x": ..., "y": ..., "r": ..., ... },
    ...
  ]
}
```

## Drill-in: modal overlay

Drill-in is a modal overlay, not a state replacement. The root cluster stays
visible behind the modal, heavily dimmed and blurred.

### Visual states

**Root state:**

- Container circle (thin stroke, subtle fill)
- 11 colored bubbles tightly packed inside
- All bubbles fully saturated and interactive (hover, click)

**Modal-open state:**

- Root cluster still visible behind, dimmed + blurred (`grayscale(1)
  blur(6px)` at ~18% opacity)
- Clicked parent bubble, in its original color, scaled up to a 540-diameter
  circle at canvas center
- Inside the scaled-up parent: children bubbles packed inscribed
- Panel content (description, bullets, screenshot) as a near-white card
  floating on the right of the canvas
- Close affordances: × button + ESC key
- Background bubbles are non-interactive (clicks ignored; must close first)

### Animation

Three phases, ~1.0s total, spring-out easing on the hero phase:

1. **Background dims + blurs** (250ms, ease-out). Root cluster gets `filter:
   grayscale(1) blur(6px)` at 18% opacity. Single CSS transition.
2. **Selected bubble zooms** (550ms, `cubic-bezier(0.34, 1.56, 0.64, 1)`).
   CSS transform on the bubble's `<g>`: translate + uniform scale from its
   root position to its open position. Spring-out overshoot gives the
   rubbery feel. GPU-accelerated.
3. **Children + panel pop in** (400ms each, staggered 40ms, easeOutBack).
   Each child bubble starts at scale 0 at its own center, scales up. Panel
   card fades + slides in from the right.

### Drill-out (close)

Reverse, faster (~700ms total):

1. Children + panel shrink and fade (200ms).
2. Selected bubble un-zooms back to its root position (450ms, easeOutBack).
3. Background un-dims (250ms, ease-out, overlaps with step 2).

Triggered by the × button or ESC key.

## Side panel

The panel content (description, bullets, screenshot, percentage) is rendered
**inside the modal** as a near-white floating card on the right of the
canvas. There is no persistent sidebar — the panel only exists when the
modal is open.

The panel carries over from the current treemap's `CorpusTreemap.astro`:
title, percentage, description, bullets, screenshot. The child-card grid in
the old panel is no longer needed since children are visible in the modal
itself.

## Sizing & responsive behavior

- **Desktop:** single full-width canvas. Cluster centered with breathing
  room around it.
- **Mobile (<700px):** cluster fills the viewport. Modal opens as a
  full-screen overlay with cells on top and panel content scrolling below.
- **Aspect:** SVG viewBox of `0 0 1000 700` scales to fit the container,
  preserving aspect ratio. No layout recomputation on resize.

## Conventions

- **No new runtime dependencies.** `d3-hierarchy` + `d3-force` are
  devDependencies only. Runtime ships precomputed JSON.
- **Modern CSS only** — `light-dark()`, logical properties, CSS nesting.
- **Pure JS build script.** No DOM imports outside the Astro shell.
- **Determinism.** Same data → same layout. The force simulation has
  no random seed but converges to the same minimum given the same
  d3.pack starting positions.

## Decisions made during planning

- **Color palette:** keep multi-color (each category its existing distinct
  color from `structure.json`). Reads as a chart of categorical data, not a
  generic illustration.
- **Staging URL:** `/corpus-bubbles`.
- **Container:** thin circle hugging the cluster (smallest enclosing circle
  from `d3.packEnclose`). No brain shape — earlier iterations had one but
  it made the cluster look small relative to the empty backdrop area.
- **Hover behavior:** tooltip on hover/focus showing label + percentage near
  the bubble. Full info in the modal on click.
- **Asset paths:** new layout JSON in `public/corpus-bubbles/`. Source-of-
  truth `structure.json` stays in `public/corpus-treemap/` since screenshot
  paths reference it.
- **Drill-in pattern:** modal overlay, not state replacement. Root stays
  visible behind in dimmed + blurred state.
- **Modal size:** parent bubble expands to a 540-diameter circle centered
  at canvas center. Panel card floats on the right of the canvas.
- **Close affordances:** × button + ESC key. (No click-outside; background
  is not interactive during modal.)
- **Background clicks during modal:** ignored. User must close first before
  opening another bubble.
- **Panel location:** inside the modal alongside the bubbles, not a
  persistent sidebar.
- **Layout algorithm:** `d3-hierarchy.pack()` for radii + `d3-force`
  compaction (root only) + `d3.packEnclose` for the container.
  Drill-ins use `d3.pack()` alone — no compaction, since `d3.pack` already
  places children tangent to the parent boundary.

## Phases

- **Phase 1 — Brain shape lib.** Dropped after switch to no-brain layout.
- **Phase 2 — Build script. Done.** `build.mjs` runs the two-mode packer,
  writes 12 layout JSON files in ~30ms.
- **Phase 3 — Static render. Done.** `CorpusBubbles.astro` renders the root
  cluster with container circle at `/corpus-bubbles`.
- **Phase 4 — Modal drill-in (no animation).** Click bubble → load
  `<id>.json` → render modal state (cluster dimmed + blurred, parent at
  open position with children inside, panel card on the right, × close).
  Crossfade between root and modal. Wire ESC + × close.
- **Phase 5 — Rubbery animation.** Three-phase open/close described above.
  Pure CSS transitions where possible.
- **Phase 6 — Mobile + reduced-motion.** Responsive sizing, mobile modal as
  full-screen overlay, `prefers-reduced-motion: reduce` → 200ms crossfade
  with no scale/translate.
- **Phase 7 — Swap `/corpus`.** Update `src/pages/corpus.astro` to use
  `CorpusBubbles`. Delete old `CorpusTreemap` files. Single commit.

## Constraints to remember

- **Never write as Irwin** (project CLAUDE.md). The on-page copy "What does
  an AI model actually train on?" carries over from the current treemap and
  was written by Irwin; do not reword.
- **Source Transparency Protocol applies** to any text on the page that
  makes a source claim. The current sources block in the renderer already
  complies.
- **Don't touch `publish.sh`** — flagged legacy.
- **No auto-commit.** Irwin reviews before push.

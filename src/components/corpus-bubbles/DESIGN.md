# Corpus Bubbles — Design Notes

Living design doc for the zoomable circle-pack visualization of AI training
data at `/corpus-bubbles`. Written so a fresh Claude session can resume the
work without re-deriving decisions.

## Goal

Replace the squarified treemap at `/corpus` with a d3-style zoomable circle
pack of AI pre-training corpus categories. Each bubble's area is
proportional to its share of training tokens. Click a bubble → it zooms in
to fill the bubble region; its children become the active level. Click the
focus or the SVG background → zoom up one level. A small sidenote-style
panel on the right swaps content per focus.

## Why this exists

The current treemap (`src/components/corpus-treemap/CorpusTreemap.astro`)
reads as a generic dashboard chart. Bubbles read as discrete units, sizes
are immediately legible from area, and a single zoom interpolation handles
every drill-in cleanly. Following the well-known d3 reference at
<https://observablehq.com/@d3/zoomable-circle-packing> keeps the
interaction mental model standard.

## History (brief)

This is the fourth iteration:

1. `d3-voronoi-treemap` clipped to a brain silhouette.
2. Brain as backdrop with bubbles inside.
3. Plain bubble cluster (no brain) with a modal-overlay drill-in
   (Phases 1–5 of the previous design — modal drill-in with rubbery spring
   animation).
4. **Current**: full hierarchy rendered at once, single transform-based
   zoom on click. The modal overlay and per-parent JSONs were dropped in
   favor of one packed tree.

## Architecture

Three layers, matching the established pattern from
`src/components/brain-3d/`:

1. **Pure-JS build script** (`src/lib/corpus-bubbles/build.mjs`) — runs at
   build time via `npm run bubbles:build`. Reads `structure.json`, packs
   the full hierarchy in one pass with `d3.pack()`, writes `tree.json`.
2. **Renderer** (`src/components/corpus-bubbles/CorpusBubbles.astro`) —
   renders every node up-front inside a `.cb-zoom-layer` `<g>`. JS owns
   the click-to-zoom interpolation, label visibility, and panel content.
3. **Astro page** (`src/pages/corpus-bubbles.astro`) — wraps the
   component with header, nav, footer.

### File layout

```
src/lib/corpus-bubbles/
  build.mjs                    # Node entry: runs d3.pack() once, writes tree.json

src/components/corpus-bubbles/
  DESIGN.md                    # this file
  CorpusBubbles.astro          # shell — SVG render, zoom, panel

src/pages/
  corpus.astro                 # /corpus — serves CorpusBubbles since the swap

public/corpus-bubbles/
  tree.json                    # full packed hierarchy, all nodes flat

public/corpus-treemap/
  structure.json               # source-of-truth data (kept under this path
                               # because screenshot paths reference it)
  screenshots/                 # category screenshot images
  thumbs/                      # thumbnails
```

CSS class prefix: `cb-` (corpus-bubbles).

### Build-time precomputation

The pack runs in ~milliseconds; we precompute at build anyway so the
runtime ships no algorithm code and layout is deterministic across
deploys.

Trade-off: when `structure.json` changes, re-run `npm run bubbles:build`.

## Layout algorithm

One pass in `build.mjs`:

1. **Apply palette.** `applyPalette` walks the tree and stamps each node
   with its category color, propagating the parent's color down so each
   category reads as one color family at every zoom level.
2. **`d3.hierarchy(data).sum(leaf? value : 0).sort(...)`** — sum at
   leaves only so internal categories get a value equal to the sum of
   their children. (For our data the explicit category value already
   equals the sum of its children's values, so this is an identity.)
3. **`d3.pack().size([D, D]).padding(P)`** — packs the whole hierarchy
   inscribed in a `D × D` square. The root circle is tangent to all four
   edges (diameter `D`). Children are tangent to siblings and to the
   parent's inner padding.
4. **Translate** so the root circle's center lands at `(REGION_CX,
   REGION_CY)` inside the viewBox.

### Output JSON shape (`tree.json`)

```jsonc
{
  "canvas": { "viewBox": [0, 0, 1000, 700] },
  "region": { "cx": 320, "cy": 350, "diameter": 620 },
  "rootId": "root",
  "nodes": [
    {
      "id": "root",
      "label": "",
      "value": 100,
      "color": null,
      "depth": 0,
      "parentId": null,
      "childIds": ["web", "logic", "academic", ...],
      "x": 320, "y": 350, "r": 310,
      "description": "", "bullets": [], "screenshot": null,
      "screenshotCaption": "", "isUnknown": false
    },
    {
      "id": "web",
      "label": "The Web",
      "value": 38,
      "color": "#809B57",
      "depth": 1,
      "parentId": "root",
      "childIds": ["web-crawl", "web-news", "web-blog"],
      "x": 213.65, "y": 361.71, "r": 144.06,
      "description": "Web crawl data is …",
      "bullets": ["CommonCrawl: …", "Quality filters …", ...],
      "screenshot": null, "screenshotCaption": "", "isUnknown": false
    },
    ...
  ]
}
```

`region.diameter` is also the canvas size into which the focus circle is
zoomed: at any focus, `k = region.diameter / view.w`.

## Zoom interaction

State: `view = [cx, cy, w]` (matches `d3-interpolate-zoom`'s
representation). The transform on `.cb-zoom-layer` is computed from the
view:

```
k  = REGION_D / view.w
tx = REGION_CX - view.cx * k
ty = REGION_CY - view.cy * k
transform: translate(tx px, ty px) scale(k)
```

A circle at `(x, y, r)` therefore lands at `(REGION_CX - (view.cx - x)*k,
REGION_CY - (view.cy - y)*k)` with radius `r*k`. When `view = [focus.x,
focus.y, focus.r * 2 * 1.05]`, the focus circle fills the bubble region
with 5% padding.

Animation: cubic ease-in-out (`t<0.5 ? 4t³ : 1 - (-2t+2)³/2`) on each
component of `view` over 750 ms via `requestAnimationFrame`. Each frame
recomputes the transform AND a CSS variable `--cb-label-scale = 1/k`
which counter-scales label `font-size` so labels stay at roughly 11 px
on screen at any zoom level.

`prefers-reduced-motion: reduce` collapses the animation to an instant
snap on each focus change. Panel content swap also skips the 180 ms
crossfade.

## Click semantics

- **Click a non-focus bubble** → `setFocus(that node)`.
- **Click the focus bubble** → `setFocus(focus.parentId)`. From root,
  no-op (root has no parent).
- **Click anywhere outside a bubble or the panel** (SVG background,
  header, footer, padding) → `setFocus(focus.parentId)`. Implemented as
  a wrap-level click listener whose `closest('.cb-panel')` check skips
  panel-region clicks; node-level handlers `stopPropagation()` so they
  don't bubble up to the wrap handler.
- **ESC** → same as background click — zoom up one level.

Keyboard: each clickable node has `role="button"` + `tabindex="0"` and
responds to Enter/Space.

## Label visibility

Following the d3 example: a node's label is shown iff `node.parentId ===
currentFocus.id`. On every focus change, JS toggles the
`data-label-on` attribute on each `<g class="cb-node">` and CSS reveals
the matching label.

Initial focus = root → labels visible for all 11 categories. Focus on a
category → labels visible for its children. Focus on a leaf → no labels
visible (a leaf has no children).

Label font size is counter-scaled by zoom (`font-size: calc(11px *
var(--cb-label-scale))`) so on-screen size stays consistent. For very
small bubbles at the root view (e.g., synthetic, unknown at r ≈ 23) the
label may overflow the circle; this is the same trade-off as the d3
reference and is acceptable.

## Sidenote panel

Sits right of the bubble region (the bubble region is pushed left of
canvas center to make room). Lives inside a `<foreignObject>` so HTML
typography rules apply. Styling matches the blog's margin notes: no
background, a thin 2 px accent left border in the focus's color, small
text (11 – 15 px), and no `overflow-y` (does not scroll).

States:

- **Focus = root** → shows a one-line hint: "Click any bubble to zoom in.
  Click outside or on the bubble again to zoom back out."
- **Focus = any other node** → shows title, percentage, description,
  bullets, optional screenshot, optional "unknown / redacted" block.

On focus change, JS toggles `data-fading` on the panel for a 180 ms
opacity crossfade, swaps the content at the midpoint, then clears the
attribute.

## Coloring

Per-category palette baked into `build.mjs`'s `PALETTE` map (sage / plum
/ teal / gold / wine / olive / coral / cool gray-blue / muted rose /
sage-yellow / charcoal). Children inherit the parent's color so each
category reads as one color family. Depth-based gradients are
intentionally avoided — identity comes from the category color, not from
depth.

## Sizing & responsive behavior

- **Desktop:** SVG fills the figure area up to 1200 px wide, preserving
  aspect ratio against the `0 0 1000 700` viewBox.
- **Mobile:** TODO (Phase 6 of the previous plan still applies — the
  panel needs to stack below the bubbles on narrow viewports).
- The bubble region (`REGION_CX = 320, REGION_CY = 350, diameter = 620`)
  is hard-coded in the build script; the renderer reads it from
  `tree.json`.

## Conventions

- **No new runtime dependencies.** `d3-hierarchy` is a devDependency
  only. Runtime ships precomputed JSON and a tiny zoom interpolation
  loop.
- **Modern CSS only** — logical properties, CSS nesting, `light-dark()`,
  custom properties.
- **Pure JS build script.** No DOM imports outside the Astro shell.
- **Determinism.** Same data → same layout. `d3.pack` is deterministic;
  the sort order (`.sort((a,b) => b.value - a.value)`) is stable.

## Decisions made during planning

- **Reference**: <https://observablehq.com/@d3/zoomable-circle-packing>.
  Match the click-to-zoom mental model exactly; keep our own per-category
  palette and our own sidenote panel for the rich info.
- **No modal overlay** — the previous Phase 4 / Phase 5 modal-overlay
  approach was scrapped in favor of the unified zoom. Simpler model,
  fewer state transitions, no duplicate render of "parent at root" vs
  "parent at open".
- **One JSON, not 12.** Drops the per-parent drill-in JSONs.
- **Color**: per-category palette (children inherit parent). Confirmed
  with user.
- **Initial view**: full tree visible at once — all 11 categories plus
  their children rendered as small circles inside. Confirmed with user.
- **Animation**: cubic ease-in-out, 750 ms. No spring overshoot — the
  previous Phase 5 rubbery-spring was specific to the modal pattern and
  doesn't translate naturally to a continuous zoom. Confirmed with user.
- **Panel position**: right of the bubble region; bubble region pushed
  left of canvas center (`REGION_CX = 320`, panel at `x = 660`).
- **Panel styling**: sidenote — no background, accent left border in the
  focus color, no scroll. Mirrors `.margin-note` in `src/styles/global.css`.
- **Close affordances**: click on focus, click on background, ESC. No ×
  button.
- **Label counter-scale**: keep labels roughly 11 px on screen at any
  zoom via `--cb-label-scale = 1/k`. Better than letting labels scale
  with zoom (which gets gigantic at deep zooms).

## Status

- **Build script**: done. `tree.json` regenerates in ~ms via
  `npm run bubbles:build`.
- **Renderer**: done. All 36 nodes, click-to-zoom, ESC, click-outside,
  panel-per-focus, label counter-scale, reduced-motion fallback — all
  verified end-to-end with Playwright.
- **Mobile responsive**: not yet. Panel currently shares the SVG
  viewBox; on narrow screens it'll get cramped. Either stack below
  bubbles on `< 700 px` or render the panel as a separate HTML block.
- **Swap `/corpus`**: done. `src/pages/corpus.astro` now imports
  `CorpusBubbles`; the staging page and `CorpusTreemap` component have
  been deleted.

## Constraints to remember

- **Never write as Irwin** (project CLAUDE.md). The on-page copy "What
  does an AI model actually train on?" carries over from the previous
  iterations and was written by Irwin; do not reword.
- **Source Transparency Protocol applies** to any text on the page that
  makes a source claim. The current sources block in the renderer
  already complies.
- **Don't touch `publish.sh`** — flagged legacy.
- **No auto-commit.** Irwin reviews before push.

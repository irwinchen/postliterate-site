# Brain Visualizer (`brain-3d`) — Design Notes

Living design doc for the 3D brain visualizer that ships interactive
neuro-anatomical figures for the *After the Book* project. Written so a fresh
Claude session can resume the work without re-deriving architecture decisions
from scratch. Mirrors the convention used by `scripts/dashboard/DESIGN.md`.

## Update (2026-06-14) — glossary groups collapse by default

The left glossary column listed all 26 parcels with every anatomical group
expanded, which overflowed the fixed-height column and threw a scrollbar.
Filtering couldn't help — all 26 registry parcels are in-view across the three
compare views, so there are no faded entries to drop. Fix is layout-only: the
group `<details>` now render **collapsed** in both shells (`details.open = false`),
so the column shows ~8 group headers + the search box and fits without scrolling.
The search box is the fast path to any term; clicking a header browses.

One dependency: leader lines only draw for *visible* glossary entries
(`drawLeaderLines` skips `offsetParent === null`). So `syncGlossary()` in both
shells now auto-opens a group whenever one of its parcels is inspected — this
keeps leader lines working for every inspect path (glossary click, search-graph,
per-paper inline refs, section "Highlight all"). The render loop redraws each
frame, so no manual redraw is needed. No CSS change (the group caret already
rotates for the closed state).

## Update (2026-06-13) — area lookahead search

Both shells (`BrainCompare3D`, `BrainViz3D`) now have a search box at the top of
the left glossary column. Typing the first characters of an area name shows a
ranked autocomplete; picking a match **graphs** it — inspects the parcel (leader
line), pulses the mesh, expands its glossary group, and scrolls + flashes its
glossary entry. The corpus is exactly the graphable parcels (those with a mesh:
`compare.parcels` / `view.parcels`), never an area the renderer can't draw.
Ranking logic is a new pure module `src/lib/brain-viz/parcel-search.js`
(`searchParcels`, 10 tests); DOM/keyboard wiring (combobox a11y, arrow/Enter/Esc)
lives in each shell; styles are shared in `brain-3d.css` (`.brain-3d__search*`,
`brain-3d-entry-flash`). Compare pulses amber; per-paper pulses the parcel's
network color to match the existing inline-ref pulse.

## Update (2026-05-14) — per-paper views

Commit `30fcd11` adds an author-only PDF upload flow (admin Papers tab → Claude
extraction → editable JSON → Save) that turns a paper into a per-paper
`/brain/papers/<slug>` route. The shell is `BrainViz3D` extended with new
`paperMeta` / `paperContent` / `glossaryMode` props: the right column becomes a
slide-out drawer with paper metadata + an accordion of body sections, inline
parcel refs styled as buttons that inspect + pulse the corresponding mesh
region in the containing network's color. New plumbing: `paper-content.js`
(pure loader + sanitizer with 7 tests), `pulseParcel()` on the renderer,
`allowZero` option on `view-state` so per-paper chips behave as pure toggles
(curated views keep the always-one-active guard). First real paper is
`blank-2026` ("Video games as stimuli in neuroimaging studies"). Partially
resolves Known issues #2 and #3 below — single-view-shaped pages exist again
under `/brain/papers/<slug>`, so `BrainViz3D` is no longer orphaned and the
chip-group anchors in the compare shell have a sensible target. The "Adding a
new view" recipe below is still accurate for curated views; the per-paper
upload flow is a separate path documented in the commit message.

## Current state (snapshot)

- **Canonical route:** `/brain/compare` — the only working brain page. Composes
  three paper-derived view configs into a single Three.js scene with cross-paper
  toggle semantics.
- **Renderer:** real fsaverage Desikan-Killiany pial mesh (70 OBJ files, 35 L +
  35 R), pre-decimated to 15% retention. Network-agnostic; consumes resolved
  views and view-state and knows nothing about specific networks.
- **Three view configs:**
  - `four-modes` — Parsons & Osherson 2001 (M1/M2), Paunov 2022 + Lipkin 2022
    atlas (M3), Paunov 2022 + Hasson 2016 + Yeo 2011 (M4).
  - `triple-network` — Menon 2011 / Seeley 2007 / Yeo 2011 (CEN, DMN, SN).
  - `vwfa` — Cohen 2002 single-ROI view (visual word form area).
- **Tests:** ~1,300 LOC unit tests across nine pure-JS lib modules. Renderer is
  visual-integration only (verified in browser, not unit tested).

## Code layout

```
src/components/brain-3d/
  BrainViz3D.astro             # single-view shell (chips + glossary + canvas)
  BrainCompare3D.astro         # cross-paper compare shell — used by /brain/compare
  BrainHeader.astro            # shared title + nav slot
  renderer.js                  # Three.js renderer; network-agnostic
  data/
    registry/
      parcels.json             # master parcel atlas (id → label, centroid, group, …)
      papers.json              # citation registry (id → authors, year, title, …)
    views/
      four-modes.json          # paper-derived view config
      triple-network.json
      vwfa.json
    content/
      four-modes.json          # text content for the view (intro, captions)
      triple-network.json
      vwfa.json

src/lib/brain-viz/             # pure JS, no DOM, fully unit-tested
  parcel-registry.js           # validates + indexes parcels.json
  view-loader.js               # single view → renderer-shaped resolved view
  compare-loader.js            # multi-view → same shape with composite IDs
  view-state.js                # single-view chip state (sequential / compare)
  cross-paper-state.js         # multi-view chip state (compare-only)
  glossary-state.js            # inspected-parcel set, drives leader lines
  parcel-search.js             # ranked lookahead matching for the area search box
  content.js                   # view text content loader
  emissive.js                  # color helpers (hex→rgb, contrast text, blending)
  label-visibility.js          # visible-label computation

src/pages/
  brain.astro                  # redirect (currently broken — see Known issues)
  brain/compare.astro          # /brain/compare page

src/styles/brain-3d.css        # shared base styles for both shells

public/brain-mesh/pial-dk-lo/  # pre-decimated fsaverage DK pial OBJs + manifest.txt

scripts/decimate-brain-mesh.mjs  # one-shot: pial-dk → pial-dk-lo at 15% retention

test/brain-viz/                # nine .test.js files, one per lib module
```

## Architecture

### Layered separation

The renderer never touches data files or DOM events. The lib modules never touch
Three.js or the DOM. The Astro shells own DOM wiring and pass two things into
`createBrainRenderer`: a **view** (resolved, renderer-shaped) and a **state**
(provides `activeNetworks()` and `subscribe()`). This is what lets the same
renderer drive both single-view and compare shells without modification.

```
  data/views/*.json                          data/registry/*.json
       │                                            │
       ▼                                            ▼
  view-loader  ──┐                          parcel-registry
                 ├──► resolved view ──┐
  compare-loader ┘                    │
                                      ├──► createBrainRenderer({ canvas, view, viewState })
  view-state    ──┐                   │       (Three.js, network-agnostic)
                  ├──► activeNetworks ┘
  cross-paper-st ─┘                              ▲
                                                 │  onAfterRender
  glossary-state ──► inspectedParcels ───────────┘  drawLeaderLines()
```

### Data shape

**Parcel** (in `data/registry/parcels.json`):
- `id` — stable string ID (e.g. `lang.LanA-IFGorb-L`, `dk.lh-frontal-coarse`)
- `label` — human display name
- `centroid` — `[x, y, z]` in mesh space
- `radius` — defaults to `0.10`
- `hemisphere` — `"L"`, `"R"`, or `null`
- `group` — anatomical group for glossary sectioning (e.g. `frontal`, `parietal-medial`)
- `provenance` — `"hand-tuned"` or atlas-grounded label; `view-loader` aggregates
  per-network and per-view provenance flags
- `note` — glossary tooltip body (optional)
- `atlas` — source atlas (optional)

**View** (in `data/views/*.json`):
- `slug` — view identifier (`four-modes`, `triple-network`, `vwfa`)
- `name`, `subtitle`
- `papers` — array of paper IDs referenced in `data/registry/papers.json`
- `networks` — `{ networkId: { displayNum, label, color, source, parcels: [parcelId, …] } }`
- `networkOrder` — explicit display order
- `defaultNetwork` — initial active network for the single-view shell
- `uiMode` — currently always `chips-with-compare`

**Compare** (the shape returned by `compare-loader`):
- Network IDs are namespaced as `viewSlug:networkId` so collisions across views
  are impossible by construction. The renderer keeps treating IDs as opaque
  strings — same code path as a single-view load. `views` and `viewOrder`
  fields carry per-view metadata so the UI can group chips by paper.

### State semantics

- **`view-state`** (single view): `sequential` (one active network, `select(id)`
  replaces) or `compare` (toggle on/off, auto-exits when set drops to one).
  Always at least one active network.
- **`cross-paper-state`** (compare): toggle-only over composite keys; active
  set may be empty (means nothing glows). No sequential mode.
- **`glossary-state`**: independent inspected-parcel set; the renderer composes
  it with the active-networks channel to draw leader lines from glossary
  entries to parcel centroids on the mesh.

### Rendering details

- Cortex is real fsaverage DK pial, loaded from `public/brain-mesh/pial-dk-lo/`
  via the manifest. Stencil-masked wireframe at 25% opacity, MeshBasicMaterial.
- Lighting: three-point with slightly warm key, cool fill, low ambient.
- Parcel emissive uses additive blending across active networks with √N intensity
  tapering (`computeParcelEmissive` in `emissive.js`). Lets shared parcels
  visibly blend (e.g. M04 ↔ DMN shows red+purple).
- Anatomical direction labels (RIGHT / LEFT / SUPERIOR / etc) are projected each
  frame from fixed 3D anchors at ±1.2; rendered as SVG overlay alongside leader
  lines so they follow camera rotation.
- Tooltip is a single floating element reused across hovers; clamped to root
  bounds.

## Conventions

- **No new dependencies.** Three.js is in already; the lib modules are pure JS
  using only Node-built / browser-built primitives. The renderer also uses two
  Three.js addons (`OBJLoader`, `OBJExporter` + `SimplifyModifier` in the
  decimator).
- **Pure-JS lib modules.** No DOM access, no Three.js imports. Anything testable
  goes in `src/lib/brain-viz/`. Anything Three.js-shaped goes in
  `src/components/brain-3d/renderer.js`. DOM glue goes in the Astro shells.
- **Network-agnostic renderer.** No hardcoded "modes" or "networks" — networks
  are arbitrary string IDs supplied by the view config.
- **Composite ID namespacing.** Compare loader uses `viewSlug:networkId` as the
  composite key. Both `compare-loader` and `cross-paper-state` import
  `compositeKey()` from `cross-paper-state` so the format has one source of truth.
- **Provenance.** Parcels declare `"hand-tuned"` vs. atlas-grounded so disclaimers
  in the UI stay honest. `view-loader` rolls these up into per-network and
  per-view flags (`handTunedNetworks`, `allHandTuned`).
- **Mesh decimation is one-shot.** `scripts/decimate-brain-mesh.mjs` reads
  `public/brain-mesh/pial-dk/`, writes `public/brain-mesh/pial-dk-lo/`. Run once;
  the renderer loads the pre-decimated dir at runtime and never simplifies on
  the fly. (The full-resolution `pial-dk` source is deliberately not committed
  if it isn't already.)
- **Parcels.json supports `_comment_*` keys.** `parcel-registry` skips them.
  Use them for inline documentation of atlas decisions inside the data file.

## Phases shipped

- **Initial** (`cce5b85`) — Brain modes 3D figure for the four cognitive modes.
- **Phase A** (`5f6f8c5`) — View-agnostic architecture refactor; glossary panel;
  leader lines from glossary entries to mesh.
- **Phase B** (`f173fe1`) — Triple Network view (CEN/DMN/SN); per-view config
  driving the same shell.
- **Phase C** (`7cf68fa`) — VWFA single-ROI view (Cohen 2002); N=1 networks
  render as static label chip (no Compare/All controls).
- **Phase D** (`deb4de4`) — Cross-paper compare; 7-color palette; anatomical
  direction labels. **Single-view routes deleted** — `/brain/compare` became
  the canonical figure.
- **Polish** (`b6bd2bf`) — Glossary tooltips on hover/focus; chip styling.
- **Cleanup** (`6cd6967`) — Removed `data/compare-presets.json` (contrast-pair
  presets were retired in favor of free-form chip toggling).

## Known issues / loose ends

_None at the moment. The Phase D loose ends listed here previously
(`brain.astro` redirect to a deleted route; chip-group headers anchoring to
deleted per-view pages; `BrainViz3D` orphaned) were resolved on 2026-05-22:
the redirect now points at `/brain/compare`; the chip-group headers were
changed from anchors to plain labels (no per-view deep link); and `BrainViz3D`
is actively used by `/brain/papers/<slug>` so the "orphaned" claim was stale._

## Adding a new view

Rough recipe (verify against current code before relying on it):

1. **Add parcels** to `data/registry/parcels.json` if the view references regions
   that aren't already in the registry. Each entry needs `label`, `centroid`,
   `group`, and `provenance` at minimum. Use `_comment_*` keys to document
   atlas decisions.
2. **Add papers** to `data/registry/papers.json` for any new citations.
3. **Create `data/views/<slug>.json`** following the View shape above. Pick
   network colors that contrast well with the existing palette so the compare
   page reads cleanly when the new view's chips are toggled alongside the
   others.
4. **Create `data/content/<slug>.json`** with the text content for the view
   (intro, captions). Schema lives in `src/lib/brain-viz/content.js` — keep it
   minimal until the shell needs more.
5. **Add the view config to `src/pages/brain/compare.astro`** — append to
   `viewConfigs` and decide whether to update `initialActive`.
6. **Add tests** in `test/brain-viz/` if you touched any lib module. Existing
   tests validate parcel resolution, network ordering, and provenance rollups.
7. **No mesh changes** are needed unless the new view references parcels
   outside the DK atlas — in which case extend `pial-dk-lo` and the manifest.

## Pointers

- Live URL: `/brain/compare` (canonical).
- Source paper attributions live in each view's `data/views/*.json` `papers`
  field and in `data/registry/papers.json`.
- For project-level context, see `PROJECT_STATUS.md` and `.planning/PROJECT.md`.
- For the dashboard sub-project's design notes (parallel pattern), see
  `scripts/dashboard/DESIGN.md`.

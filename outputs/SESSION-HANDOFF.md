# Session handoff — vector-space arc

Written at a natural pause point: the embedding-space prototype is working; the broader arc has been redesigned around the model as protagonist; next concrete task is a terrain-style dot prototype. This doc captures where we are so the next session can pick up cleanly.

## Where we are

Working standalone prototype: `outputs/three-prototype.html`.

Renders 559 GPT-2 tokens (32 from the printing-press sentence in red, 527 curated comparison words in grey) at their real 3D t-SNE coordinates over real GPT-2 `wte` embeddings.

UI state:

- Sentence tokens always labeled in accent red.
- Comparison tokens labeled only on direct dot-hover, or when within the 6-nearest-neighbors of a clicked token.
- Drag to orbit, scroll to zoom, click to lock neighbors, click empty to clear.
- Full viewport, breadcrumb nav floating over canvas, light/dark theme toggle.

## Data pipeline

- `outputs/build_prod_data.py` — pulls GPT-2 `wte` from HuggingFace, tokenizes the sentence + the curated word list, filters comparison candidates to single-token GPT-2 encodings, runs sklearn 3D t-SNE (perplexity 30, cosine metric, init=pca, KL ≈ 0.804), precomputes 6-NN in 768-dim cosine space.
- `outputs/prod-data.json` — 87 KB, inlined into the HTML.

Real GPT-2 throughout. No illustrative numbers. Verified clusters: `king → queen, prince`; `cat → dog, rabbit`; `paper → parchment, manuscript`; `Monday → Tuesday, Wednesday`.

## Technical lessons — carry forward to all future Three.js work

These cost real debugging time in this session. Worth re-reading before next prototype.

1. **Canvas intrinsic size fights `inset: 0` on hi-DPI.** Three.js's `setSize(w, h, false)` sets the canvas's `width`/`height` *attributes* to `w * pixelRatio`. On Retina those attributes become the canvas's intrinsic CSS size and override `inset: 0`. Force CSS sizing to win with explicit `inline-size: 100%; block-size: 100%` on the canvas.
2. **Don't trust `canvas.clientWidth`** once Three.js has touched the drawing buffer. Derive viewport dimensions from a non-canvas element (the labels container, or `.stage`).
3. **Use a `ResizeObserver` on the stage.** The initial `clientWidth` read at script-load time is often wrong because layout hasn't settled. ResizeObserver catches the post-layout reflow.
4. **Attach OrbitControls to `.stage`, not the canvas.** Labels with `pointer-events: auto` are siblings of canvas; wheel/click events on them bubble through the stage but never reach canvas. Bind controls to the common ancestor.
5. **Gate label `pointer-events` on opacity.** Invisible labels with `pointer-events: auto` silently block clicks and drags.
6. **Stop `pointerdown` propagation on label clicks** so clicking a label doesn't accidentally start an OrbitControls orbit drag.

## The bigger arc — reframed mid-session

Original framing was: trace a sentence through a series of demos.

New framing (this session, decided with Irwin): **the model is the protagonist; the arc is its biography.**

Three parts:

**Prologue: How a thought becomes text** — orality and literacy. Pre-AI. Human side.

**Arc 1: How AI is trained** — pretraining + RLHF. The model takes shape.

**Arc 2: How AI reads and writes** — runtime. Hidden state moves, attention reaches back, a word is sampled, features fire.

The existing `/tokens` page (and the 3D vector-space prototype that replaces its stage 6) sits inside Arc 1's pretraining portion. The model emerges from this process; once it exists, Arc 2 operates it.

## Visual metaphors decided

- **Pin board** (Irwin's instinct): kept for the *awe moment*. One slide. "Each parameter is one pin; there are 124 million pins; each pin's height is one number the model memorized."
- **Terrain** (extension): through-line metaphor across Arc 1. The model's weights as a stippled topographic landscape. Pretraining sculpts it. RLHF polishes specific regions. Inference (Arc 2) is a dot rolling across it, settling in valleys = high-probability outputs.

## Reference aesthetic

Irwin shared two reference pens. The second image — stippled cyan/white dots forming a landscape — is the model. The aesthetic notes:

- Dots, not solid mesh. Implies sampling, quantization, "many small things." Matches the existing embedding-space view's visual language.
- Built from a regular grid (e.g., 200×200 = 40K dots), `y = noise(x, z)`.
- Reads at every camera angle: far away = landscape, up close = individual pins. Earns the awe-zoom.
- For continuity with the rest of the project, shift the colorway: off-white dots on dark ground for the terrain itself, with the project's `#E53E33` accent reserved for the protagonist word and for active events on the terrain (RLHF intervention markers, the moving hidden state, etc.). Keeps the accent meaningful.

## Immediate next task

Build `outputs/terrain-prototype.html` — a static dot-terrain in the project palette. Same engine, breadcrumb, fonts, palette as `three-prototype.html`. Content is a regular grid of dots, `y = noise(x, z)`. No other elements yet. Confirm aesthetic before adding anything.

If it holds, the natural follow-ups are:

1. Animate pretraining — noise field settles from a flat plain into mature terrain as "text" is ingested.
2. Animate RLHF — selective re-shaping of specific regions, smoothing rough patches, raising forbidden mountains.
3. The awe-zoom — camera move from full landscape down to a single pin.

## Open decisions (carried forward)

- **Protagonist word**: recommend ` press`. Appears in the printing-press sentence, has a rich semantic neighborhood, is thematically central to the book.
- **Where the new visualizations live**: route per illustration + a meta-route (`/trace` or similar) that walks the protagonist through all of them.
- **Group I treatment** (thought / orality / literacy): static SVG vs the same Three.js engine. Static SVG probably reads better for non-data illustrations and is much cheaper.
- **Stage 11 (sampling)**: illustrative — hand-authored probabilities for clarity — is fine.
- **Stage 12 (features)**: hand-authored 3–4 directions for the illustration, captioned explicitly as illustrative-not-measured. Real SAE-derived features for GPT-2 would be a weeks-long project of its own.

## Twelve-stage breakdown (for reference)

Numbering carried from earlier in the session. Some are existing, some are new.

**Prologue**
1. Thought — silhouette + glow inside head.
2. Orality — soundwave from mouth.
3. Literacy — soundwave settles as ink on a page.

**Arc 1 — How AI is trained**
4. The corpus (existing `/corpus`).
5. Tokenization (existing `/tokens` stages 1–3).
6. The integer ID (existing `/tokens` stage 4).
7. The embedding vector (existing `/tokens` stage 5, heatmap strips).
8. The vector space (existing `/tokens` stage 6 — replaced by `three-prototype.html`).
9. **The terrain** — new. Pretraining shapes the model's weight landscape. ← next prototype.
10. **RLHF** — new. Selective polish of the terrain.

**Arc 2 — How AI reads and writes**
11. Reading is navigation — hidden state trajectory through the embedding space.
12. Attention is reaching back — weighted arcs from prior tokens.
13. Writing is sampling — probability halo + sampled-token highlight.
14. The dot is a chord — feature directions arrows.

(Numbers wandered as the arc was rethought; the doc above uses the conceptual ordering, not the earlier strict 1–12.)

## Files of record

- `outputs/three-prototype.html` — working 3D embedding viewer (the room).
- `outputs/prod-data.json` — 559 tokens with t-SNE coords + neighbors.
- `outputs/build_prod_data.py` — Python pipeline to regenerate `prod-data.json`.
- `outputs/proto_data.py` — earlier 32-token PCA prototype data builder (kept for history).
- `src/components/corpus-tokens/DESIGN.md` — existing pipeline design doc (predates the 3D work).
- `src/components/corpus-tokens/PipelineStages.astro` — production renderer; stage 6 not yet updated to 3D.
- `src/components/corpus-tokens/build.mjs` — `source.json → stages.json` reducer; doesn't yet carry `proj3` or the comparison set.

## What to do in the next session

1. Read this handoff.
2. Skim `outputs/three-prototype.html` to internalize the existing prototype's layout and the gotchas above.
3. Build `outputs/terrain-prototype.html` per the spec.
4. After Irwin approves the aesthetic, plan the integration of the terrain into Arc 1 and figure out how it lives alongside (or transitions into) the embedding-space view.

Do not integrate into `PipelineStages.astro` yet. The arc reframe likely changes what the integration even looks like. The standalone prototypes are the right scratchpad until the full arc is locked.

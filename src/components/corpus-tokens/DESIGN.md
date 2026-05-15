# Corpus Tokens — Design Notes

Living design doc for the pipeline visualization at `/tokens` — how a raw
stream of text becomes tokens and then vectors. Companion to the corpus
page (`/corpus`). Written so a fresh Claude session can resume Phase 2
without re-deriving decisions.

## Goal

Show, end to end, what happens to a real sentence as it enters an AI
model: raw characters → pre-tokenization → BPE tokens → integer IDs →
embedding vectors → a point in vector space. Six stages, one sentence,
morphing from each stage into the next.

The sentence is the verified opening line of English Wikipedia's
"Printing press" article. Every token, ID, embedding row, position row,
and the 2D projection is real GPT-2 output — see "Data pipeline" below.

## Why this exists

The corpus page answers *what* AI models read. This answers *what
happens to it next*. It's the natural sequel and reuses the same visual
language (off-white ground, single red accent, the corpus page's font
stack).

It also has a teaching job: the moment text becomes numbers — and then
geometry — is the part most people never see. The morph is the argument.
Watching a token tile literally stretch into a 768-cell heatmap strip,
then collapse into a dot in a scatter, makes "vectorization" concrete in
a way prose can't.

## Status

- **Phase 1 — data pipeline: done.** `tokenize.py` → `source.json` →
  `build.mjs` → `public/corpus-tokens/stages.json` (197 KB). Real GPT-2
  throughout. Verified: 165 chars → 31 pre-token chunks → 32 BPE tokens.
- **Phase 2 — component + page: not started.** This doc is the plan.
- **Phase 3 — verify: not started.** `tokens:build`, `astro build`,
  render check, confirm no runtime dependency added.

## Architecture

Three layers, same pattern as `corpus-bubbles`:

1. **Data pipeline** (`src/lib/corpus-tokens/`) — `tokenize.py` runs the
   real GPT-2 pipeline once and writes `source.json` (the hand-authored
   "truth" file, with full float64 embeddings — ~750 KB, not shipped).
   `build.mjs` reduces it to a compact `stages.json` and writes it to
   `public/corpus-tokens/`. Run via `npm run tokens:build`.
2. **Renderer** (`src/components/corpus-tokens/PipelineStages.astro`) —
   renders the 32 tokens once as persistent elements and owns the morph
   between stages, the stepper, and hover-linking.
3. **Astro page** (`src/pages/tokens.astro`) — wraps the component in the
   nav/header/footer shell, mirroring `corpus.astro`.

### File layout

```
src/lib/corpus-tokens/
  tokenize.py          # provenance: real GPT-2 pipeline -> source.json
  source.json          # hand-authored truth, full float embeddings (not shipped)
  build.mjs            # reduces source.json -> public/corpus-tokens/stages.json

src/components/corpus-tokens/
  DESIGN.md            # this file
  PipelineStages.astro # renderer — morph, stepper, hover-linking

src/pages/
  tokens.astro         # /tokens — serves PipelineStages

public/corpus-tokens/
  stages.json          # compact shipped data, ~197 KB
```

CSS class prefix: `ct-` (corpus-tokens).

## Data pipeline (Phase 1 — done)

`tokenize.py` (in `src/lib/corpus-tokens/`, run in a sandbox with
`tiktoken`, `numpy`, `safetensors`, `regex`, and GPT-2's weights):

- Tokenizes the sentence with the real `gpt2` tiktoken encoding
  (byte-level BPE, vocab 50257).
- Applies GPT-2's pre-tokenizer regex for the pre-tokenization stage.
- Pulls real `wte` rows (768-dim) for each token ID, and real `wpe`
  rows for positions 0..N.
- Computes a real 2D PCA over the sentence tokens plus 18 comparison
  words (cat, dog, king, queen, paper, ink, …).

`build.mjs` byte-quantizes the embedding + position rows (0–255 against
one global min/max — lossless for *display*, ~6× smaller) and writes
`stages.json`. Token IDs, text, and PCA coordinates stay exact.

### `stages.json` shape

```jsonc
{
  "meta": { "source": "...", "model": "GPT-2 ...", "tokenizer": "...",
            "dModel": 768, "embeddingEncoding": "byte-quantized ..." },
  "sentence": "A printing press is a mechanical device for ...",
  "preTokens": ["A", " printing", " press", ...],   // 31 regex chunks
  "tokens": [
    { "pos": 12, "id": 287, "text": " in", "display": "·in",
      "leadingSpace": true, "proj": [-1.4473, 0.3974],
      "emb": [134, 135, ...] }                       // 768 bytes
    // ... 32 tokens
  ],
  "dims": 768,
  "embScale": { "min": -4.5381, "max": 4.0653 },
  "positionVectors": [[...768 bytes...], ...],        // 32 rows
  "comparison": [ { "text": "cat", "id": 3797, "proj": [-0.042, -0.486] }, ... ],
  "projectionExtent": { "x": [..], "y": [..] }
}
```

### Phase 2 change needed in `build.mjs`

The 31 pre-token chunks and 32 tokens are not 1:1 — `" inked"` is one
pre-token that becomes two tokens (`" in"` + `"ked"`). The stage 2→3
morph (see below) needs each token to know which pre-token chunk it came
from. **Add a `preIndex` field per token in `build.mjs`** by walking the
pre-token strings and the token strings in parallel. This is the only
data change Phase 2 requires.

## The six stages

The persistent unit is the **token** — all 32 token elements exist in
the DOM at every stage. A "stage" is a *layout + active form* for those
32 elements. Moving between stages animates position, size, and which
visual layer is showing.

1. **Raw text** — the 32 token elements sit flush with no gaps and no
   color, so they read as one unbroken character ribbon. Caption: it's
   165 characters, no structure.
2. **Pre-tokenization** — gaps open *between pre-token chunks* but not
   within them. Tokens sharing a `preIndex` stay flush. 31 visible
   groups. The odd splits (`" ("`, `"such"`) are visible.
3. **Tokens** — gaps open *between every token*. 32 colored tiles, the
   recognizable token-box look. `" inked"` is now visibly two tiles —
   the split is just a gap appearing, no special-case animation.
4. **Token IDs** — each tile's content cross-fades from its text to its
   integer. Tiles hold position. The positional-encoding note layer
   fades in here (see below).
5. **Embedding vectors** — each tile morphs into a tall, thin heatmap
   strip (768 cells, real quantized values). Tiles reposition from
   wrapped text-flow into an evenly spaced row of 32 strips.
6. **Vector space** — each strip collapses to a point at its real `proj`
   coordinate. The 18 comparison-word points fade in. Related words
   cluster. Text has become geometry.

### Positional-encoding note layer

Stages 4–5 show a faint secondary layer: the real `positionVectors`,
making the point that order is *added back* separately — without it the
model has only a bag of tokens. Keep it quiet (low opacity, small) — a
note, not a stage.

## Morph mechanics

Each `.ct-token` is one persistent, absolutely-positioned element with a
CSS `transform` for position and explicit `width`/`height`. It contains
stacked, cross-faded layers:

- `.ct-token-text` — the token string (`display` field, leading space
  shown as `·`)
- `.ct-token-id` — the integer ID
- `.ct-token-heat` — a small `<canvas>` (768×1 image, scaled up) for the
  heatmap strip; cheaper than 768 DOM rects × 32
- `.ct-token-dot` — a small disc for the scatter stage

A **stage definition** is a function `token → { x, y, w, h, layer }`.
Changing stage sets new targets; CSS transitions on `transform`, `width`,
`height` (~600 ms ease) animate the morph; layer `opacity` cross-fades.
No per-frame JS loop needed for the basic morph — unlike corpus-bubbles,
the transitions are property-based, not a `view` interpolation. A small
JS module owns: current stage state, computing the per-stage layouts,
the stepper, hover-linking, and the reduced-motion snap.

Stage 6 needs the scatter coordinate space: map `projectionExtent` →
the stage region, place token dots and comparison dots. Comparison dots
and any axis hints exist only in stage 6 (fade in/out).

## Interaction

- **Stepper** — prev/next controls plus clickable stage labels (1–6).
  Arrow keys advance/retreat. Consider auto-advance on first load? No —
  let the user drive (matches corpus-bubbles' "user controls zoom").
- **Hover-linking** — every element carries `data-token-pos`. Hovering a
  token sets `data-hover="<pos>"` on the wrap; CSS highlights the match
  and dims the rest. Because all 32 tokens exist at every stage, you can
  hover `" inked"` and watch it light up across the whole pipeline —
  raw slice, pre-token chunk, two tiles, two IDs, two strips, two dots.
- **Reduced motion** — `prefers-reduced-motion: reduce` snaps stages
  instead of animating (same approach as corpus-bubbles).

## Conventions

- **No new runtime dependencies.** `regex` is a sandbox-only Python dep
  for `tokenize.py`; nothing new ships. Runtime is precomputed JSON + a
  small layout/morph module.
- **Modern CSS only** — logical properties, nesting, custom properties.
- **Match the corpus page shell** — reuse `corpus.astro`'s nav/header/
  footer structure and its font stack (Alegreya / Outfit / Sono) so the
  two pages read as a pair.
- **Determinism.** Same `source.json` → same `stages.json` → same
  layout.

## Decisions made (with user)

- **Interactive web component** — not a static diagram, not
  scrollytelling. Confirmed with user.
- **GPT-2 end-to-end** — real `gpt2` tokenizer, real `wte`/`wpe`
  matrices, real PCA. No illustrative numbers anywhere. Confirmed with
  user.
- **Sentence** — opening line of Wikipedia's "Printing press" article.
  Confirmed with user. Thematic fit with the *After the Book* project.
- **Morph, not hard cuts** — stages animate into each other. Confirmed
  with user. The morph is the teaching device.
- **Persistent token elements** — 32 token elements live for the whole
  page; stages are layouts over them. This is what makes the morph (and
  hover-linking across stages) possible.

## Open questions / TODO

- `build.mjs`: add the `preIndex` field per token (see above). **Done in
  Phase 2.**
- On-page copy — headline, stage captions, the framing line — must be
  **written by Irwin**, not Claude (project `CLAUDE.md`). Phase 2 should
  scaffold the structure and mark placeholder copy as `inline code`.
- Mobile responsive — 32 strips in a row will not fit a narrow viewport.
  Same open problem corpus-bubbles has; defer or stack.
- Scatter stage: do the PCA axes get labels, or stay unlabeled? Unlabeled
  is more honest (PCA axes aren't interpretable) — lean unlabeled with a
  caption that says so.
- Heatmap strip: 768 cells is a lot of visual noise. Consider whether the
  strip shows all 768 or a labeled sample. Leaning all-768 via canvas —
  the wall-of-color effect is the point.

## Phase 3 — prologue (deferred, not yet built)

Confirmed with user 2026-05-14: a prologue plays *before* the six
pipeline stages, motivating where the sentence comes from. It is the
landing-from-corpus-page sequel:

1. Coming from `/corpus`, the user clicks the "Web" bubble → zooms into
   Wikipedia → zooms into an article → article text fills the screen.
2. The HTML source streams in (raw markup), then collapses to plain text
   filling the screen as one unstructured flow.
3. The opening sentence ("A printing press is a mechanical device for…")
   is "pulled out" / focused on; the rest of the page text fades or
   recedes.
4. That sentence lands as the existing **Stage 1 — Characters** state
   (32 tokens flush, no chrome, no color).

The prologue is *one* entrance animation that plays on first visit and
can be replayed via a control. It is **not** one of the six numbered
pipeline stages — the stepper still starts at "Characters." Build later
as Phase 3.

Open: should this be a route from `/corpus` (deep link) or run inline on
`/tokens` first paint? Probably the latter, with a "Replay intro" link.

## Phase 2 — fixes applied post-implementation

- Dark-mode text contrast: the `[data-theme='dark']` selectors got
  Astro-scoped onto the `<html>` element (which doesn't carry the
  component's cid attribute), so the dark-mode tile overrides were inert
  — light-theme pastel tiles stayed pastel under dark theme and the
  light `--text` color vanished against them. Fix: tiles are now light
  pastels in both themes, and tile text is pinned to `#1a1a1a` regardless
  of theme. The component's other theme-aware colors (background, body
  text, captions, scatter labels) still flow through CSS variables and
  work in both themes because they live on elements *inside* the scope.

## Constraints to remember

- **Never write as Irwin** (project `CLAUDE.md`). Page prose is his.
  Claude scaffolds structure and frontmatter; any suggested copy goes in
  as `inline code`.
- **Source Transparency Protocol applies.** The page makes claims about
  how tokenization works; the `meta` block in `stages.json` already
  records full provenance (source, model, tokenizer, encoding). Keep any
  on-page claims grounded in it.
- **No auto-commit.** Irwin reviews before push. When committing, include
  every file the pipeline writes — `source.json`, `build.mjs`,
  `tokenize.py`, `stages.json`, the component, the page, and the
  `package.json` script change.
- **Don't touch `publish.sh`** — flagged legacy (carries over from the
  repo-wide conventions).

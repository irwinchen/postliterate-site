#!/usr/bin/env node
/**
 * Precompute the shipped data file for the corpus-tokens figure.
 *
 * Pipeline mirrors corpus-bubbles: a hand-authored "truth" file
 * (`source.json`, generated once by `tokenize.py` against real GPT-2) is
 * read here, reduced to a compact shippable form, and written to
 * `public/corpus-tokens/stages.json`. The renderer ships only the small
 * JSON and a tiny amount of layout JS — no tokenizer, no model, no
 * algorithm code at runtime.
 *
 * `source.json` carries full float64 embedding rows (32 tokens x 768 dims
 * plus 32 position rows) — ~750 KB, far too heavy to ship. The only
 * runtime use of those numbers is to color heatmap cells, so we quantize
 * each value to a single byte (0–255) against a global min/max. That is
 * lossless *for display purposes* and cuts the payload by ~6x. The exact
 * float values, token IDs, and 2D PCA coordinates all stay real — nothing
 * here is illustrative or invented.
 *
 * Output: `public/corpus-tokens/stages.json`.
 *
 * @module corpus-tokens/build
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const REPO_ROOT = join(__dirname, '..', '..', '..');
const SOURCE_PATH = join(REPO_ROOT, 'src', 'lib', 'corpus-tokens', 'source.json');
const OUTPUT_DIR = join(REPO_ROOT, 'public', 'corpus-tokens');

// ---------- Helpers ----------

/**
 * Quantize a list of float vectors to bytes (0–255) against one global
 * min/max so every heatmap cell across every vector shares a color scale.
 * Returns the byte rows plus the scale (so the renderer can label the real
 * range if it wants to).
 */
function quantize(vectors) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of vectors) {
    for (const x of v) {
      if (x < min) min = x;
      if (x > max) max = x;
    }
  }
  const span = max - min || 1;
  const rows = vectors.map((v) =>
    v.map((x) => Math.round(((x - min) / span) * 255)),
  );
  return { rows, scale: { min: round(min), max: round(max) } };
}

function round(x, p = 4) {
  return Math.round(x * 10 ** p) / 10 ** p;
}

/**
 * Map each BPE token to the pre-token chunk it came from. Pre-tokens and
 * tokens are not 1:1 — e.g. `" inked"` (one pre-token) becomes `" in"` +
 * `"ked"` (two tokens). Walking both lists in parallel, we consume token
 * text from the current pre-token until it's exhausted, then advance.
 *
 * The stage 2→3 morph uses `preIndex` to keep tokens-from-the-same-chunk
 * flush in stage 2 (pre-tokenization) and split them apart in stage 3.
 *
 * Throws on misalignment — that would mean source.json is internally
 * inconsistent and should be regenerated rather than silently coerced.
 */
function assignPreIndices(preTokens, tokens) {
  const indices = new Array(tokens.length);
  let p = 0;
  let remaining = preTokens[0] ?? '';
  for (let t = 0; t < tokens.length; t++) {
    const text = tokens[t].text;
    while (remaining.length === 0 && p < preTokens.length - 1) {
      p += 1;
      remaining = preTokens[p];
    }
    if (!remaining.startsWith(text)) {
      throw new Error(
        `preIndex alignment failed at token ${t} (${JSON.stringify(text)}) ` +
          `vs pre-token ${p} (${JSON.stringify(remaining)})`,
      );
    }
    indices[t] = p;
    remaining = remaining.slice(text.length);
  }
  return indices;
}

// ---------- Main ----------

function main() {
  const t0 = Date.now();
  const src = JSON.parse(readFileSync(SOURCE_PATH, 'utf8'));
  mkdirSync(OUTPUT_DIR, { recursive: true });

  // Quantize token embeddings and position vectors against one shared
  // scale so the embedding stage and the positional-encoding note layer
  // are visually comparable.
  const tokenEmb = src.tokens.map((t) => t.embedding);
  const { rows: embRows, scale: embScale } = quantize(
    tokenEmb.concat(src.positionVectors),
  );
  const tokenEmbRows = embRows.slice(0, src.tokens.length);
  const posEmbRows = embRows.slice(src.tokens.length);

  // Map each BPE token back to its source pre-token chunk so the stage
  // 2→3 morph can group tokens that share a pre-token (and split apart
  // tokens that don't, like " in" + "ked" from " inked").
  const preIndices = assignPreIndices(src.preTokens, src.tokens);

  // Reassemble tokens in the compact shape the renderer consumes. Drop the
  // full float embedding (kept only in source.json); keep id, text, the
  // byte-quantized embedding row, and the real PCA coordinate.
  const tokens = src.tokens.map((t, i) => ({
    pos: t.pos,
    id: t.id,
    text: t.text,
    display: t.display,
    leadingSpace: t.leadingSpace,
    preIndex: preIndices[i],
    proj: t.proj,
    emb: tokenEmbRows[i],
  }));

  const out = {
    meta: {
      ...src._meta,
      // record what build.mjs did so the provenance is self-describing
      embeddingEncoding:
        'byte-quantized (0–255) against a global min/max; exact floats in source.json',
    },
    sentence: src.sentence,
    // Stage 1 → 2: the regex pre-tokenizer split, then the BPE tokens.
    preTokens: src.preTokens,
    // Stages 2–5: id, text, quantized embedding row, 2D PCA coordinate.
    tokens,
    dims: tokenEmb[0].length,
    embScale,
    // Stage 4 note layer: real GPT-2 position rows, same byte scale.
    positionVectors: posEmbRows,
    // Stage 5: comparison words placed in the same PCA space.
    comparison: src.comparison,
    projectionExtent: src.projectionExtent,
  };

  writeFileSync(join(OUTPUT_DIR, 'stages.json'), JSON.stringify(out), 'utf8');

  const dt = ((Date.now() - t0) / 1000).toFixed(2);
  const bytes = Buffer.byteLength(JSON.stringify(out));
  console.log(
    `Done. stages.json (${tokens.length} tokens, ${out.dims}-dim, ` +
      `${(bytes / 1024).toFixed(0)} KB) written to ${OUTPUT_DIR} in ${dt}s.`,
  );
}

main();

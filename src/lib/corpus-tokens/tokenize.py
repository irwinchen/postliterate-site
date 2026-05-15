#!/usr/bin/env python3
"""
Phase 1 data pipeline for the corpus-tokens visualization.

Runs the real GPT-2 pipeline on the verified Wikipedia "Printing press"
opening sentence:
  1. pre-tokenization  -- GPT-2's regex pre-tokenizer split
  2. tokenization      -- tiktoken gpt2 BPE encode -> tokens + integer IDs
  3. embedding         -- real GPT-2 wte rows for each token ID
  4. positions         -- real GPT-2 wpe rows for positions 0..N-1
  5. projection        -- real 2D PCA over the sentence tokens + a set of
                          comparison words, so "near = related" is visible

Output: corpus-tokens-source.json  (the hand-authored "truth" file the
Astro build step will lay out -- mirrors corpus-bubbles/structure.json).
"""

import json
import numpy as np
import tiktoken
import regex
from safetensors.numpy import load_file

# Verified verbatim against the fetched en.wikipedia.org/wiki/Printing_press
# article (fragments confirmed by grep against the primary source; the
# canonical plain-text reading also confirmed via web search).
SENTENCE = (
    "A printing press is a mechanical device for applying pressure to an "
    "inked surface resting upon a print medium (such as paper or cloth), "
    "thereby transferring the ink."
)

GPT2_WEIGHTS = "/tmp/gpt2.safetensors"
OUT_PATH = "/sessions/determined-cool-mccarthy/mnt/outputs/corpus-tokens-source.json"

# GPT-2's pre-tokenizer regex (the split applied before BPE merges run).
GPT2_PAT = regex.compile(
    r"""'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+"""
)

# Comparison words for the vector-space stage. Leading spaces because GPT-2
# encodes word-with-leading-space as the common single token; picking the
# first token of each keeps them single-token for a clean scatter.
COMPARISON_WORDS = [
    " cat", " dog", " king", " queen", " paper", " ink",
    " machine", " device", " book", " word", " Monday", " Tuesday",
    " three", " seven", " Paris", " London", " run", " walk",
]


def find_key(weights, *candidates):
    """GPT-2 safetensors key names vary by export; resolve wte/wpe robustly."""
    for c in candidates:
        if c in weights:
            return c
    # fall back: suffix match
    for k in weights:
        for c in candidates:
            if k.endswith(c):
                return k
    raise KeyError(f"none of {candidates} in {list(weights)[:8]}...")


def main():
    enc = tiktoken.get_encoding("gpt2")

    # -- Stage 2: tokenization (real BPE) --
    ids = enc.encode(SENTENCE)
    tokens = []
    for pos, tid in enumerate(ids):
        raw = enc.decode_single_token_bytes(tid)
        text = raw.decode("utf-8", errors="replace")
        tokens.append({
            "pos": pos,
            "id": int(tid),
            "text": text,
            "leadingSpace": text.startswith(" "),
            "display": text.replace(" ", "·", 1) if text.startswith(" ") else text,
        })

    # -- Stage 1: pre-tokenization (regex split, before BPE) --
    pre_chunks = GPT2_PAT.findall(SENTENCE)

    # -- Stages 3 & 4: real GPT-2 embedding + position matrices --
    weights = load_file(GPT2_WEIGHTS)
    wte_key = find_key(weights, "wte.weight", "transformer.wte.weight")
    wpe_key = find_key(weights, "wpe.weight", "transformer.wpe.weight")
    wte = np.asarray(weights[wte_key], dtype=np.float64)  # (50257, 768)
    wpe = np.asarray(weights[wpe_key], dtype=np.float64)  # (1024, 768)
    d_model = wte.shape[1]

    sent_emb = np.stack([wte[t["id"]] for t in tokens])          # (N, 768)
    pos_emb = np.stack([wpe[i] for i in range(len(tokens))])     # (N, 768)

    # attach the full embedding vector (rounded) to each token for the heatmap
    for t, vec in zip(tokens, sent_emb):
        t["embedding"] = [round(float(x), 4) for x in vec]

    # -- comparison words --
    comparison = []
    for w in COMPARISON_WORDS:
        cid = enc.encode(w)[0]
        comparison.append({
            "text": w.strip(),
            "id": int(cid),
            "_emb": wte[cid],
        })

    # -- Stage 5: real 2D PCA over sentence tokens + comparison words --
    comp_emb = np.stack([c["_emb"] for c in comparison])
    combined = np.vstack([sent_emb, comp_emb])                  # (N+M, 768)
    mean = combined.mean(axis=0)
    centered = combined - mean
    # SVD-based PCA; Vt[:2] are the top-2 principal axes.
    _u, _s, vt = np.linalg.svd(centered, full_matrices=False)
    proj = centered @ vt[:2].T                                  # (N+M, 2)

    n = len(tokens)
    for i, t in enumerate(tokens):
        t["proj"] = [round(float(proj[i, 0]), 4), round(float(proj[i, 1]), 4)]
    for j, c in enumerate(comparison):
        c["proj"] = [round(float(proj[n + j, 0]), 4), round(float(proj[n + j, 1]), 4)]
        del c["_emb"]

    out = {
        "_meta": {
            "source": "en.wikipedia.org/wiki/Printing_press (opening sentence)",
            "model": "GPT-2 (openai-community/gpt2)",
            "tokenizer": "tiktoken gpt2 encoding (byte-level BPE, vocab 50257)",
            "dModel": d_model,
            "note": "All tokens, IDs, embedding rows, position rows, and the "
                    "2D PCA are real GPT-2 values -- nothing illustrative.",
        },
        "sentence": SENTENCE,
        "preTokens": pre_chunks,
        "tokens": tokens,
        "positionVectors": [
            [round(float(x), 4) for x in pos_emb[i]] for i in range(n)
        ],
        "comparison": comparison,
        "projectionExtent": {
            "x": [round(float(proj[:, 0].min()), 4), round(float(proj[:, 0].max()), 4)],
            "y": [round(float(proj[:, 1].min()), 4), round(float(proj[:, 1].max()), 4)],
        },
    }

    with open(OUT_PATH, "w") as f:
        json.dump(out, f, indent=2)

    print(f"sentence chars : {len(SENTENCE)}")
    print(f"pre-tokens     : {len(pre_chunks)} -> {pre_chunks}")
    print(f"tokens         : {len(tokens)}")
    print(f"token IDs      : {[t['id'] for t in tokens]}")
    print(f"token texts    : {[t['text'] for t in tokens]}")
    print(f"d_model        : {d_model}")
    print(f"wte/wpe keys   : {wte_key} / {wpe_key}")
    print(f"comparison     : {len(comparison)} words")
    print(f"written        : {OUT_PATH}")


if __name__ == "__main__":
    main()

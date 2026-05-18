# Corpus Bubbles — Screenshot Checklist

Screenshots for the **corpus page** (`src/pages/corpus.astro` → `CorpusBubbles.astro`).
Each leaf bubble's `screenshot` field in `public/corpus-bubbles/tree.json` points here.

## Where files go

- Full size: `public/corpus-treemap/screenshots/<id>.png`
- Thumbnails: `public/corpus-treemap/thumbs/<id>.png`

The bubbles viz loads the full-size image. Thumbs are carried over from the old
treemap — regenerate them after replacing any screenshot so they stay in sync.

## Capture spec

- **1200×750px**, top of page (matches existing real captures).
- Filename must match the node `id` exactly — that's how `tree.json` resolves it.

After replacing files, regenerate thumbs:

```bash
cd /Users/irwinchen/Documents/postliterate-site
python3 -c "
from PIL import Image
import os
s = 'public/corpus-treemap/screenshots'
t = 'public/corpus-treemap/thumbs'
for f in os.listdir(s):
    if f.endswith('.png'):
        Image.open(f'{s}/{f}').resize((300,190), Image.LANCZOS).save(f'{t}/{f}')
print('done')
"
```

---

## Needed — 13 files

These are currently 8,737-byte placeholders. Capture real screenshots.

### The Web

- [x] `web-news.png` — AP News homepage (https://apnews.com). Show the wire-service front page: datelines, bylines, headline stack.
- [x] `web-blog.png` — Simon Willison's blog homepage (https://simonwillison.net). Show a personal technical blog: long-form posts, first-person voice.

### Code & Math

- [x] `logic-arxiv-math.png` — arXiv math paper abstract page (https://arxiv.org/abs/math/0509116). Show the abstract view with LaTeX-rendered notation.
- [x] `logic-mathoverflow.png` — MathOverflow homepage (https://mathoverflow.net). Show research-level math Q&A: question list, votes, tags.

### Books

- [x] `books-books3.png` — Internet Archive books section (https://archive.org/details/books). Public-domain-adjacent scans; Books3 itself used opaque piracy channels, so this stands in for the digitization side.

### Forums & Q&A

- [x] `forums-reddit-good.png` — r/explainlikeimfive (https://www.reddit.com/r/explainlikeimfive/). Show the subreddit feed: the "explain it simply" register.
- [x] `forums-stackoverflow.png` — Stack Overflow homepage (https://stackoverflow.com). Show the question feed — voted answers as a quality signal. (Note: distinct from the `logic-stackoverflow.png` capture, which is already done.)

### Wikipedia

- [x] `wiki-tamil.png` — Tamil Wikipedia homepage (https://ta.wikipedia.org). Show a non-English Wikipedia edition — the multilingual foundation.

### Legal & Government

- [x] `legal-freelaw.png` — Justia court opinions (https://law.justia.com). Show a court-opinion portal: case listings, citations.
- [x] `legal-patent.png` — Google Patents homepage (https://patents.google.com). Show the patent search interface — structured claims and prior art.

### Multilingual

- [x] `multilingual-europarl.png` — European Parliament portal (https://www.europarl.europa.eu/portal/en). Show the EU Parliament site — proceedings published across 24 official languages.

### Transcripts

- [x] `transcripts-opensubs.png` — OpenSubtitles homepage (https://www.opensubtitles.org). Show the subtitle database — film/TV dialogue across languages.

### Synthetic Data

- [x] `synthetic-rstar.png` — rStar-Math arXiv paper (https://arxiv.org/abs/2501.04519). Show the paper page — AI-generated reasoning traces used for training.

---

## Done — 7 files

Real captures already in place. Skip unless you want to re-shoot.

- [x] `academic-arxiv-recursive.png` — GPT-4 Technical Report on arXiv (the paper that became training data for later models).
- [x] `academic-pubmed.png` — PubMed Central — open-access biomedical literature.
- [x] `books-gutenberg.png` — Project Gutenberg — public-domain book collection.
- [x] `logic-github.png` — Linux kernel on GitHub — collaborative source code.
- [x] `logic-stackoverflow.png` — Stack Overflow — voted programmer Q&A.
- [x] `transcripts-youtube.png` — YouTube — auto-caption source for transcript datasets.
- [x] `wiki-english.png` — English Wikipedia — the most upweighted single source.

---

## Not used (no screenshot)

These leaf nodes have `screenshot: null` in `tree.json` — no capture needed:
`web-crawl`, `academic-other`, `multilingual-cc100`, `unknown-proprietary`.

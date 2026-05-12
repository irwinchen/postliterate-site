# Screenshot Capture Checklist

Capture at **1200×750px**, top of page. Save to `public/corpus-treemap/screenshots/`.
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

## To capture (15 files)

- [ ] `web-news.png` — https://apnews.com — AP News homepage
- [ ] `web-blog.png` — https://simonwillison.net — Simon Willison's blog homepage
- [ ] `logic-arxiv-math.png` — https://arxiv.org/abs/math/0509116 — arXiv math paper (abstract page)
- [ ] `logic-mathoverflow.png` — https://mathoverflow.net — MathOverflow homepage
- [ ] `academic-pubmed.png` — https://www.ncbi.nlm.nih.gov/pmc/ — PubMed Central homepage
- [ ] `books-books3.png` — https://archive.org/details/books — Internet Archive books section
- [ ] `forums-reddit-good.png` — https://www.reddit.com/r/explainlikeimfive/ — r/explainlikeimfive
- [ ] `forums-stackoverflow.png` — https://stackoverflow.com — Stack Overflow homepage
- [ ] `wiki-tamil.png` — https://ta.wikipedia.org — Tamil Wikipedia homepage
- [ ] `legal-freelaw.png` — https://law.justia.com — Justia court opinions
- [ ] `legal-patent.png` — https://patents.google.com — Google Patents homepage
- [ ] `multilingual-europarl.png` — https://www.europarl.europa.eu/portal/en — European Parliament homepage
- [ ] `transcripts-youtube.png` — https://www.youtube.com — YouTube homepage
- [ ] `transcripts-opensubs.png` — https://www.opensubtitles.org — OpenSubtitles homepage
- [ ] `synthetic-rstar.png` — https://arxiv.org/abs/2501.04519 — rStar-Math arXiv paper

---

## Already good — skip these (5 files)

- [x] `academic-arxiv-recursive.png` — GPT-4 paper on arXiv
- [x] `logic-github.png` — Linux kernel on GitHub
- [x] `logic-stackoverflow.png` — Stack Overflow
- [x] `wiki-english.png` — English Wikipedia
- [x] `books-gutenberg.png` — Project Gutenberg

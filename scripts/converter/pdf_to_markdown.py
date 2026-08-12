#!/usr/bin/env python3
"""
pdf_to_markdown.py

High-fidelity PDF -> Markdown conversion for the PostLiterate research vault.

What it does, in order:

  1. Reads the PDF's text layer with PyMuPDF, keeping font size, weight,
     superscript flags and bounding boxes for every span.
  2. Finds running heads and running feet by looking for lines that repeat in
     the same screen position across many pages, and strips them. The printed
     page number is pulled out of that same material before it is discarded.
  3. Works out the body font size, then promotes larger sizes to headings.
  4. Finds the footnote zone at the foot of each page (smaller type, often
     under a rule) and converts it into real Markdown footnotes, wiring the
     superscript markers in the body to the note text.
  5. Extracts raster images and vector figures, saves them next to the
     Markdown, matches captions, and places them in reading order.
  6. Detects tables and emits them as Markdown tables.
  7. Reassembles paragraphs: de-hyphenates line breaks, joins lines, and joins
     paragraphs that run across a page break.
  8. Optionally sends each page image plus the extracted Markdown to a
     multimodal model on OpenRouter to repair layout, headings, math and
     tables, and to OCR pages that have no text layer at all.

Page numbers survive as HTML comments (`<!-- page 47 -->`) by default, so they
are invisible in Obsidian's reader but greppable and stable for citation.

Install:
    pip3 install pymupdf requests --break-system-packages

Optional, for the verification and OCR passes:
    export OPENROUTER_API_KEY=sk-or-...

Usage:
    python3 pdf_to_markdown.py paper.pdf
    python3 pdf_to_markdown.py paper.pdf -o Articles/Paper.md
    python3 pdf_to_markdown.py paper.pdf --verify
    python3 pdf_to_markdown.py paper.pdf --verify --model qwen/qwen3-vl-235b-a22b-instruct
    python3 pdf_to_markdown.py PDFs/ --out-dir Converted/ --verify --workers 6
    python3 pdf_to_markdown.py scan.pdf --ocr force --dpi 250
    python3 pdf_to_markdown.py book.pdf --pages 40-72 --page-markers visible
"""

from __future__ import annotations

import argparse
import base64
import datetime
import io
import json
import os
import re
import statistics
import sys
import time
import zlib
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

try:
    import pymupdf  # PyMuPDF >= 1.24
except ImportError:  # pragma: no cover - older installs expose the fitz alias
    try:
        import fitz as pymupdf  # type: ignore
    except ImportError:
        sys.exit(
            "PyMuPDF is required.\n"
            "  pip3 install pymupdf --break-system-packages"
        )

try:
    import requests
except ImportError:
    requests = None  # only needed for the OpenRouter passes


# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

# Open-weight multimodal defaults. Check https://openrouter.ai/models for
# current ids and prices before changing these.
DEFAULT_VERIFY_MODEL = "qwen/qwen3-vl-235b-a22b-instruct"
DEFAULT_OCR_MODEL = "qwen/qwen3-vl-235b-a22b-instruct"

# Span flag bits used by PyMuPDF.
FLAG_SUPERSCRIPT = 1 << 0
FLAG_ITALIC = 1 << 1
FLAG_BOLD = 1 << 4

CAPTION_RE = re.compile(
    r"^\s*(figure|fig|table|tab|plate|chart|map|scheme|exhibit|illustration|box)"
    r"\s*\.?\s*([0-9]{1,3}[a-z]?|[ivxlcdm]{1,6})\b[\.\:\)\—\-–]?\s*",
    re.IGNORECASE,
)

FOOTNOTE_START_RE = re.compile(
    r"^\s*(?:"
    r"([0-9]{1,3}|[\*\u2020\u2021\u00a7\u00b6\|]{1,3})\s*[\.\)]?\s+"
    r"|([0-9]{1,3})(?=[A-Z\u201c\u2018\"])"
    r"|([\*\u2020\u2021\u00a7\u00b6]{1,3})(?=[A-Za-z\u201c\u2018\"])"
    r")"
)


def footnote_marker_of(text: str) -> Optional[Tuple[str, int]]:
    """Return (marker, end offset) if the line opens a footnote."""
    m = FOOTNOTE_START_RE.match(text)
    if not m:
        return None
    marker = m.group(1) or m.group(2) or m.group(3)
    if not marker:
        return None
    return marker, m.end()

ROMAN_RE = re.compile(r"^[ivxlcdmIVXLCDM]{1,7}$")

LIGATURES = {
    "\ufb00": "ff",
    "\ufb01": "fi",
    "\ufb02": "fl",
    "\ufb03": "ffi",
    "\ufb04": "ffl",
    "\ufb05": "st",
    "\ufb06": "st",
    "\u00ad": "",       # soft hyphen
    "\u200b": "",       # zero width space
    "\ufeff": "",
    "\u2010": "-",      # hyphen
    "\u2011": "-",      # non-breaking hyphen
}

SUPERSCRIPT_DIGITS = {
    "\u2070": "0", "\u00b9": "1", "\u00b2": "2", "\u00b3": "3", "\u2074": "4",
    "\u2075": "5", "\u2076": "6", "\u2077": "7", "\u2078": "8", "\u2079": "9",
}

SENTENCE_END = tuple(".!?:;\u201d\u2019\")]}")


@dataclass
class Config:
    dpi: int = 200
    page_markers: str = "comment"          # comment | visible | none
    footnote_placement: str = "end"        # end | page
    extract_figures: bool = True
    extract_vector_figures: bool = True
    detect_tables: bool = True
    bold_headings: bool = True
    join_pages: bool = True
    min_image_px: int = 90
    verify: bool = False
    verify_model: str = DEFAULT_VERIFY_MODEL
    ocr_mode: str = "auto"                 # auto | force | off
    ocr_model: str = DEFAULT_OCR_MODEL
    workers: int = 4
    sidecar: bool = False
    quiet: bool = False
    api_key: Optional[str] = None
    max_retries: int = 3
    temperature: float = 0.0


def log(cfg: Config, message: str) -> None:
    if not cfg.quiet:
        print(message, flush=True)


# --------------------------------------------------------------------------
# Small text helpers
# --------------------------------------------------------------------------

def clean_text(text: str) -> str:
    for src, dst in LIGATURES.items():
        text = text.replace(src, dst)
    for src, dst in SUPERSCRIPT_DIGITS.items():
        text = text.replace(src, dst)
    text = text.replace("\t", " ")
    text = re.sub(r"[ ]{2,}", " ", text)
    return text


def normalise_for_repeat(text: str) -> str:
    """Collapse a line to a shape that survives changing page numbers."""
    t = clean_text(text).strip().lower()
    t = re.sub(r"\d+", "#", t)
    t = re.sub(r"[^\w#]+", " ", t)
    return t.strip()


def is_page_number(text: str) -> bool:
    t = text.strip().strip(".—–-[]() ")
    if not t:
        return False
    if t.isdigit() and len(t) <= 5:
        return True
    # Single-letter roman numerals only count in lowercase: a bare capital
    # "I" in the footer zone is almost always the pronoun, not page one.
    if ROMAN_RE.match(t) and len(t) <= 7 and (len(t) >= 2 or t.islower()):
        return True
    m = re.match(r"^(?:page|p\.?)\s*(\d{1,5})$", t, re.IGNORECASE)
    return bool(m)


def extract_page_number(text: str) -> Optional[str]:
    t = text.strip().strip(".—–-[]() ")
    if t.isdigit():
        return t
    if ROMAN_RE.match(t) and (len(t) >= 2 or t.islower()):
        return t.lower()
    m = re.match(r"^(?:page|p\.?)\s*(\d{1,5})$", t, re.IGNORECASE)
    if m:
        return m.group(1)
    m = re.search(r"\b(\d{1,5})\b", t)
    if m and len(t) <= 12:
        return m.group(1)
    return None


def dehyphenate_join(left: str, right: str) -> str:
    """Join two text lines, healing a hyphen broken across the line end."""
    if not left:
        return right
    if not right:
        return left
    if left.endswith("-") and not left.endswith("--"):
        stem = left[:-1]
        tail = right.lstrip()
        # Keep the hyphen when it looks like a real compound.
        if stem and stem[-1].islower() and tail and tail[0].islower():
            return stem + tail
        if stem and stem[-1].isdigit() and tail and tail[0].isdigit():
            return stem + "-" + tail
        return stem + tail
    if left.endswith(("\u2014", "\u2013", "/")):
        return left + right.lstrip()
    return left + " " + right.lstrip()


def rect_of(bbox: Sequence[float]) -> pymupdf.Rect:
    return pymupdf.Rect(bbox)


def horizontal_overlap(a: Sequence[float], b: Sequence[float]) -> float:
    left = max(a[0], b[0])
    right = min(a[2], b[2])
    if right <= left:
        return 0.0
    width = min(a[2] - a[0], b[2] - b[0])
    return (right - left) / width if width else 0.0


# --------------------------------------------------------------------------
# Page model
# --------------------------------------------------------------------------

@dataclass
class Line:
    text: str
    bbox: Tuple[float, float, float, float]
    size: float
    bold: bool
    italic: bool
    block_no: int
    spans: List[Dict[str, Any]] = field(default_factory=list)
    consumed: bool = False


@dataclass
class Unit:
    """One emitted piece of Markdown, with the y position it came from."""
    kind: str                       # paragraph | heading | figure | table | list
    text: str
    bbox: Tuple[float, float, float, float]
    column: int = 0
    level: int = 0
    ends_open: bool = False         # paragraph continues past the page break


@dataclass
class PageResult:
    index: int                      # zero-based PDF page index
    label: str                      # printed page number if found, else index+1
    units: List[Unit]
    footnotes: List[Tuple[str, str]]
    rect: Tuple[float, float, float, float]
    char_count: int
    needs_ocr: bool
    image_paths: List[str] = field(default_factory=list)


def collect_lines(
    page: "pymupdf.Page",
) -> Tuple[List[Line], List[Dict[str, Any]], bool, Optional[float]]:
    """Return text lines, raw image blocks, whether the text layer was a
    shattered OCR overlay that had to be reassembled (see
    consolidate_fragments), and the column split that reassembly used.

    The split is threaded through to process_page because it is far more
    reliable when measured on hundreds of raw fragments than when re-derived
    from the ~hundred merged lines."""
    data = page.get_text("dict")
    lines: List[Line] = []
    image_blocks: List[Dict[str, Any]] = []

    for block in data.get("blocks", []):
        if block.get("type") == 1:
            image_blocks.append(block)
            continue
        block_no = block.get("number", 0)
        for raw_line in block.get("lines", []):
            direction = raw_line.get("dir", (1.0, 0.0))
            if abs(direction[0]) < 0.92 or abs(direction[1]) > 0.35:
                continue  # rotated text: margin stamps, sidebars, watermarks
            spans = [s for s in raw_line.get("spans", []) if s.get("text")]
            if not spans:
                continue
            text = clean_text("".join(s["text"] for s in spans))
            if not text.strip():
                continue
            weights = [(s["size"], len(s["text"])) for s in spans]
            total = sum(w for _, w in weights) or 1
            size = sum(sz * w for sz, w in weights) / total
            bold = sum(len(s["text"]) for s in spans if s.get("flags", 0) & FLAG_BOLD) > total / 2
            italic = sum(len(s["text"]) for s in spans if s.get("flags", 0) & FLAG_ITALIC) > total / 2
            lines.append(
                Line(
                    text=text,
                    bbox=tuple(raw_line["bbox"]),
                    size=round(size, 2),
                    bold=bold,
                    italic=italic,
                    block_no=block_no,
                    spans=spans,
                )
            )
    lines.sort(key=lambda ln: (round(ln.bbox[1], 1), ln.bbox[0]))
    merged, frag_split = consolidate_fragments(lines, tuple(page.rect))
    return merged, image_blocks, merged is not lines, frag_split


def chrome_candidates(
    lines: Sequence[Line], rect: Sequence[float]
) -> List[Tuple[int, str]]:
    """Lines that could be a running head, running foot or page number.

    Two tests, unioned. The first is geometric but measured against the type
    block rather than the paper, so it survives scans with deep margins. The
    second catches a head or foot set off from the body by extra leading,
    which is how most books mark it.
    """
    if not lines:
        return []
    order = sorted(range(len(lines)), key=lambda i: lines[i].bbox[1])
    tops = [lines[i].bbox[1] for i in order]
    bottoms = [lines[i].bbox[3] for i in order]
    block_top, block_bottom = min(tops), max(bottoms)
    block_height = max(block_bottom - block_top, 1.0)

    gaps = [tops[i + 1] - bottoms[i] for i in range(len(order) - 1)]
    positive = [g for g in gaps if g > 0]
    leading = statistics.median(positive) if positive else 4.0
    cutoff = max(leading * 2.2, 9.0)

    out: Dict[int, str] = {}

    top_limit = block_top + block_height * 0.075
    bottom_limit = block_bottom - block_height * 0.075
    for i in order:
        if lines[i].bbox[3] <= top_limit:
            out[i] = "top"
        elif lines[i].bbox[1] >= bottom_limit:
            out[i] = "bottom"

    # Isolated opening lines.
    for pos in range(min(3, len(order) - 1)):
        i = order[pos]
        if len(lines[i].text) > 95:
            break
        if gaps[pos] >= cutoff:
            out[i] = "top"
            break


    # Isolated closing lines.
    for back in range(1, min(4, len(order))):
        pos = len(order) - back
        i = order[pos]
        if len(lines[i].text) > 95:
            break
        if gaps[pos - 1] >= cutoff:
            out[i] = "bottom"
            break

    return sorted(out.items())


def detect_chrome(
    page_lines: Dict[int, List[Line]],
    page_rects: Dict[int, Tuple[float, float, float, float]],
) -> Tuple[Dict[int, List[int]], Dict[int, Optional[str]]]:
    """Find running heads/feet by repetition, and pull the page label out.

    Returns (chrome line indices per page, printed page label per page).
    """
    n_pages = len(page_lines)
    band_hits: Dict[Tuple[str, str], List[Tuple[int, int]]] = defaultdict(list)
    labels: Dict[int, Optional[str]] = {i: None for i in page_lines}

    for idx, lines in page_lines.items():
        for li, band in chrome_candidates(lines, page_rects[idx]):
            shape = normalise_for_repeat(lines[li].text)
            if not shape:
                shape = "#"
            band_hits[(band, shape)].append((idx, li))

    chrome: Dict[int, List[int]] = defaultdict(list)
    threshold = max(3, int(n_pages * 0.35))

    for (band, shape), hits in band_hits.items():
        pages_hit = {p for p, _ in hits}
        bare_number = shape.replace(" ", "") in {"#", ""}
        if bare_number:
            # A lone number in the margin is a page number on any page.
            for p, li in hits:
                chrome[p].append(li)
                label = extract_page_number(page_lines[p][li].text)
                if label and labels.get(p) is None:
                    labels[p] = label
            continue
        if len(pages_hit) >= threshold and n_pages >= 4:
            for p, li in hits:
                chrome[p].append(li)
                if labels.get(p) is None:
                    label = extract_page_number(page_lines[p][li].text)
                    if label and not is_page_number(page_lines[p][li].text):
                        # running head with a number tucked in it
                        labels[p] = label
                    elif label and is_page_number(page_lines[p][li].text):
                        labels[p] = label

    # Second pass: a short numeric line in the outer margin bands that the
    # repetition test missed because the document is short.
    for idx, lines in page_lines.items():
        if labels.get(idx):
            continue
        for li, _band in chrome_candidates(lines, page_rects[idx]):
            if li in chrome.get(idx, []):
                continue
            if is_page_number(lines[li].text) and len(lines[li].text.strip()) <= 8:
                labels[idx] = extract_page_number(lines[li].text)
                chrome[idx].append(li)
                break

    labels = interpolate_labels(labels)
    return {k: sorted(set(v)) for k, v in chrome.items()}, labels


def interpolate_labels(labels: Dict[int, Optional[str]]) -> Dict[int, Optional[str]]:
    """Fill in pages whose printed number was not recoverable.

    Plate pages and full-page tables often carry no number, but the run either
    side does. If the neighbours are numeric and consecutive, the gap is
    arithmetic and can be filled without guessing.
    """
    # Real roman-numbered front matter comes in runs (i, ii, iii...). A lone
    # roman label in a document with no other roman labels is OCR noise — a
    # speck read as the letter "i" is enough to produce one.
    roman_pages = [
        i for i, v in labels.items()
        if isinstance(v, str) and v and not v.isdigit()
    ]
    if len(roman_pages) == 1:
        labels[roman_pages[0]] = None

    indices = sorted(labels)
    numeric = {
        i: int(labels[i])
        for i in indices
        if isinstance(labels.get(i), str) and labels[i].isdigit()
    }
    if len(numeric) < 2:
        return labels
    known = sorted(numeric)
    for i in indices:
        if i in numeric:
            continue
        before = [k for k in known if k < i]
        after = [k for k in known if k > i]
        if not before or not after:
            continue
        lo, hi = before[-1], after[0]
        span_pages = hi - lo
        span_numbers = numeric[hi] - numeric[lo]
        if span_pages == span_numbers and span_pages > 0:
            labels[i] = str(numeric[lo] + (i - lo))
        elif span_numbers >= 0 and span_pages > span_numbers:
            # An unnumbered insert: a plate, a divider, a full-page table.
            suffix = "abcdefgh"[min(i - lo - 1, 7)]
            labels[i] = f"{numeric[lo]}{suffix}"

    # Leading and trailing pages, where there is only one side to lean on.
    first_known, last_known = known[0], known[-1]
    for i in indices:
        if labels.get(i) and i in numeric:
            continue
        if i < first_known and numeric[first_known] - (first_known - i) > 0:
            labels[i] = str(numeric[first_known] - (first_known - i))
        elif i > last_known:
            labels[i] = str(numeric[last_known] + (i - last_known))
    return labels


def body_font_size(page_lines: Dict[int, List[Line]]) -> float:
    counter: Counter = Counter()
    for lines in page_lines.values():
        for line in lines:
            counter[round(line.size * 2) / 2] += len(line.text)
    if not counter:
        return 10.0
    return counter.most_common(1)[0][0]


def heading_scale(page_lines: Dict[int, List[Line]], body: float) -> Dict[float, int]:
    """Map font sizes above the body size onto heading levels 1-4."""
    counter: Counter = Counter()
    for lines in page_lines.values():
        for line in lines:
            size = round(line.size * 2) / 2
            if size > body + 0.6 and len(line.text.strip()) > 1:
                counter[size] += len(line.text)
    if not counter:
        return {}
    sizes = sorted(counter, reverse=True)
    # Ignore sizes that appear only once or twice in the whole document and are
    # not clearly display type: they are usually drop caps or logos.
    sizes = [s for s in sizes if counter[s] >= 4 or s > body * 1.6]
    mapping: Dict[float, int] = {}
    for level, size in enumerate(sizes[:4], start=1):
        mapping[size] = level
    return mapping


def detect_column_split(
    lines: Sequence[Line], rect: Sequence[float]
) -> Optional[float]:
    """Return the x coordinate splitting a two-column page, or None."""
    body_lines = [ln for ln in lines if len(ln.text.strip()) > 12]
    if len(body_lines) < 12:
        return None
    width = rect[2] - rect[0]
    mid = rect[0] + width / 2
    narrow = [ln for ln in body_lines if (ln.bbox[2] - ln.bbox[0]) < width * 0.58]
    if len(narrow) < len(body_lines) * 0.65:
        return None
    left = [ln for ln in narrow if (ln.bbox[0] + ln.bbox[2]) / 2 < mid]
    right = [ln for ln in narrow if (ln.bbox[0] + ln.bbox[2]) / 2 >= mid]
    if len(left) < 4 or len(right) < 4:
        return None
    gap_start = max(ln.bbox[2] for ln in left)
    gap_end = min(ln.bbox[0] for ln in right)
    if gap_end - gap_start < width * 0.02:
        return None
    return (gap_start + gap_end) / 2


def column_of(bbox: Sequence[float], split: Optional[float]) -> int:
    if split is None:
        return 0
    centre = (bbox[0] + bbox[2]) / 2
    return 0 if centre < split else 1


def robust_column_split(
    lines: Sequence[Line], rect: Sequence[float]
) -> Optional[float]:
    """Column split for shattered OCR layers, tolerant of centred chrome.

    detect_column_split infers the gutter from the extreme edges of left- and
    right-centred lines, which one centred watermark or download stamp
    crossing the gutter destroys (and chrome removal happens later). Instead,
    scan candidate x positions across the middle of the page and pick the
    band that the fewest body fragments cross, allowing a couple of
    outliers. Guard against false gutters in single-column word-soup by
    requiring the band's neighbourhood to be densely crossed — a real gutter
    is a clear slot between two dense columns.
    """
    body = [ln for ln in lines if len(ln.text.strip()) > 12]
    if len(body) < 16:
        return None
    width = rect[2] - rect[0]
    if width <= 0:
        return None

    def crossings(x: float) -> int:
        return sum(1 for ln in body if ln.bbox[0] < x < ln.bbox[2])

    step = width / 240
    candidates = []
    x = rect[0] + width * 0.32
    stop = rect[0] + width * 0.68
    while x <= stop:
        candidates.append((crossings(x), x))
        x += step
    min_cross = min(c for c, _ in candidates)
    if min_cross > max(2, int(0.02 * len(body))):
        return None
    clear_xs = [x for c, x in candidates if c == min_cross]
    split = statistics.median(clear_xs)

    # A genuine gutter sits between two dense columns; word-soup on a
    # single-column page is sparse everywhere and fails this check. Contrast
    # is relative to the band's own crossing count — full-width chrome (the
    # JSTOR download stamp) inflates every candidate equally.
    need = max(4, int(2.5 * (min_cross + 1)))
    if crossings(split - width * 0.06) < need or crossings(split + width * 0.06) < need:
        return None
    left = sum(1 for ln in body if (ln.bbox[0] + ln.bbox[2]) / 2 < split)
    right = len(body) - left
    if left < max(4, len(body) * 0.15) or right < max(4, len(body) * 0.15):
        return None
    return split


def consolidate_fragments(
    lines: List[Line], rect: Sequence[float]
) -> Tuple[List[Line], Optional[float]]:
    """Rebuild visual lines from a shattered OCR text layer.

    Scanned PDFs with an OCR overlay (JSTOR offprints and the like) expose
    word-sized fragments whose y coordinates jitter by a few points. Sorting
    those by (y, x) shuffles words within a visual line, which scrambles every
    stage downstream. Cluster fragments into rows by vertical overlap, then
    merge each row back into visual lines — per column side when a column
    split is detectable, whole-row for display type and for fragments that
    physically cross the split. Born-digital pages, whose lines arrive whole,
    fail the fragmentation gate and are returned untouched (same list object,
    so callers can detect that nothing happened by identity).
    """
    if len(lines) < 8:
        return lines, None
    stripped = [len(ln.text.strip()) for ln in lines]
    med_len = statistics.median(stripped)
    frag_share = sum(1 for n in stripped if n < 14) / len(lines)
    if med_len >= 18 or frag_share < 0.5:
        return lines, None

    med_size = statistics.median(ln.size for ln in lines)
    body_frags = [ln for ln in lines if ln.size <= med_size * 1.35]
    split = detect_column_split(body_frags, rect)
    if split is None:
        split = robust_column_split(body_frags, rect)

    # Greedy row clustering: fragments join the current row when their
    # vertical extent overlaps the row's running mean extent by at least 45%
    # of the smaller height. Input is sorted by vertical centre, so only the
    # most recent row needs checking.
    rows: List[Dict[str, Any]] = []
    for ln in sorted(lines, key=lambda l: ((l.bbox[1] + l.bbox[3]) / 2, l.bbox[0])):
        y0, y1 = ln.bbox[1], ln.bbox[3]
        h = max(1.0, y1 - y0)
        row = rows[-1] if rows else None
        if row is not None:
            row_h = max(1.0, row["y1"] - row["y0"])
            overlap = min(row["y1"], y1) - max(row["y0"], y0)
            if overlap >= 0.45 * min(h, row_h):
                row["items"].append(ln)
                n = len(row["items"])
                row["y0"] += (y0 - row["y0"]) / n
                row["y1"] += (y1 - row["y1"]) / n
                continue
        rows.append({"y0": y0, "y1": y1, "items": [ln]})

    def merge_run(run: List[Line]) -> Line:
        run = sorted(run, key=lambda l: l.bbox[0])
        if len(run) == 1:
            return run[0]
        text = clean_text(" ".join(ln.text.strip() for ln in run))
        bbox = (
            min(l.bbox[0] for l in run),
            min(l.bbox[1] for l in run),
            max(l.bbox[2] for l in run),
            max(l.bbox[3] for l in run),
        )
        weights = [(l.size, max(1, len(l.text))) for l in run]
        total = sum(w for _, w in weights)
        size = sum(sz * w for sz, w in weights) / total
        bold = sum(len(l.text) for l in run if l.bold) > total / 2
        italic = sum(len(l.text) for l in run if l.italic) > total / 2
        spans = [s for l in run for s in l.spans]
        return Line(
            text=text,
            bbox=bbox,
            size=round(size, 2),
            bold=bold,
            italic=italic,
            block_no=run[0].block_no,
            spans=spans,
        )

    out: List[Line] = []
    for row in rows:
        items = sorted(row["items"], key=lambda l: l.bbox[0])
        display = statistics.median(l.size for l in items) > med_size * 1.35
        crosses = split is not None and any(
            l.bbox[0] < split < l.bbox[2] for l in items
        )
        if split is None or display or crosses:
            runs = [items]
        else:
            left = [l for l in items if (l.bbox[0] + l.bbox[2]) / 2 < split]
            right = [l for l in items if (l.bbox[0] + l.bbox[2]) / 2 >= split]
            runs = [run for run in (left, right) if run]
        for run in runs:
            merged_line = merge_run(run)
            # Scan OCR guesses type size and bold per word and gets both
            # wrong constantly, which would make random body lines register
            # as headings. Body rows get the page's median size and lose the
            # bold flag; display rows (real titles and subheads) keep their
            # measured values.
            if not display:
                merged_line.size = round(med_size, 2)
                merged_line.bold = False
            out.append(merged_line)
    return out, split


# --------------------------------------------------------------------------
# Footnotes
# --------------------------------------------------------------------------

def find_footnote_rule(page: "pymupdf.Page", rect: Sequence[float]) -> Optional[float]:
    """Return the y of a short horizontal rule low on the page, if there is one."""
    height = rect[3] - rect[1]
    width = rect[2] - rect[0]
    best: Optional[float] = None
    try:
        drawings = page.get_drawings()
    except Exception:
        return None
    for d in drawings:
        r = d.get("rect")
        if r is None:
            continue
        if r.height > 2.5:
            continue
        if r.width < width * 0.15 or r.width > width * 0.60:
            continue
        if r.y0 < rect[1] + height * 0.62:
            continue
        if r.y0 > rect[3] - height * 0.02:
            continue
        if best is None or r.y0 < best:
            best = r.y0
    return best


def _zone_is_plausible(
    lines: Sequence[Line],
    zone: Sequence[int],
    available: Sequence[int],
    body: float,
    require_marker: bool,
) -> bool:
    """Reject a candidate footnote zone that has swallowed the page."""
    if not zone:
        return False
    zone_chars = sum(len(lines[i].text) for i in zone)
    page_chars = sum(len(lines[i].text) for i in available) or 1
    if zone_chars / page_chars > 0.45:
        return False

    # A footnote apparatus sits under body text. If the page above the zone
    # holds no running prose, the zone is chart furniture, not notes.
    zone_set = set(zone)
    body_above = sum(
        len(lines[i].text)
        for i in available
        if i not in zone_set and lines[i].size >= body - 0.3
    )
    if body_above < 200:
        return False

    sizes = [lines[i].size for i in zone]
    if statistics.median(sizes) > body + 0.35:
        return False
    has_marker = any(footnote_marker_of(lines[i].text) for i in zone)
    if require_marker and not has_marker:
        return False
    if not has_marker and statistics.median(sizes) > body - 0.5:
        return False
    return True


def detect_footnote_lines(
    page: "pymupdf.Page",
    lines: Sequence[Line],
    rect: Sequence[float],
    body: float,
    available: Sequence[int],
) -> List[int]:
    """Indices of lines that belong to the footnote apparatus."""
    if not available:
        return []
    height = rect[3] - rect[1]
    rule_y = find_footnote_rule(page, rect)
    small_cut = body - 0.6

    if rule_y is not None:
        zone = sorted(
            i for i in available
            if lines[i].bbox[1] >= rule_y - 1.0 and lines[i].size <= body + 0.4
        )
        if _zone_is_plausible(lines, zone, available, body, require_marker=False):
            return zone

    # No usable rule. Walk up from the foot of the page while the type stays
    # smaller than the body, and require at least one real note marker.
    ordered = sorted(available, key=lambda i: lines[i].bbox[1])
    zone_floor = rect[1] + height * 0.58
    run: List[int] = []
    for i in reversed(ordered):
        line = lines[i]
        if line.bbox[1] < zone_floor:
            break
        if line.size <= small_cut:
            run.append(i)
            continue
        break
    zone = sorted(run)
    if _zone_is_plausible(lines, zone, available, body, require_marker=True):
        return zone
    return []


def group_footnotes(
    lines: Sequence[Line], indices: Sequence[int], page_label: str
) -> List[Tuple[str, str]]:
    """Turn footnote lines into (key, text) pairs."""
    notes: List[Tuple[str, List[str]]] = []
    for i in indices:
        line = lines[i]
        text = line.text.strip()
        if not text:
            continue
        marker = None
        first = line.spans[0] if line.spans else None
        if first is not None and (first.get("flags", 0) & FLAG_SUPERSCRIPT):
            candidate = clean_text(first["text"]).strip()
            if candidate:
                marker = candidate.strip(".) ")
                text = text[len(clean_text(first["text"]).strip()):].strip()
                text = re.sub(r"^[\.\)]\s*", "", text)
        if marker is None:
            hit = footnote_marker_of(text)
            if hit:
                marker, end = hit
                text = text[end:]
        if marker:
            notes.append((marker, [text]))
        elif notes:
            notes[-1][1].append(text)
        else:
            notes.append(("*", [text]))

    result: List[Tuple[str, str]] = []
    for ordinal, (marker, chunks) in enumerate(notes, start=1):
        body_text = ""
        for chunk in chunks:
            body_text = dehyphenate_join(body_text, chunk)
        key = footnote_key(page_label, marker, ordinal)
        result.append((key, body_text.strip()))
    return result


SYMBOL_MARKERS = {
    "*": "star", "**": "star2", "***": "star3",
    "\u2020": "dagger", "\u2020\u2020": "dagger2",
    "\u2021": "ddagger", "\u00a7": "sect", "\u00b6": "para",
}


def footnote_key(page_label: str, marker: str, ordinal: Optional[int] = None) -> str:
    safe_page = re.sub(r"[^\w]", "", str(page_label))
    marker = marker.strip()
    if re.fullmatch(r"\w+", marker):
        return f"p{safe_page}-{marker}"
    if marker in SYMBOL_MARKERS:
        return f"p{safe_page}-{SYMBOL_MARKERS[marker]}"
    return f"p{safe_page}-s{ordinal or 1}"


def inline_footnote_refs(line: Line, body: float, page_label: str, known: set) -> str:
    """Rebuild a line's text with superscript markers turned into [^key]."""
    parts: List[str] = []
    spans = line.spans
    for idx, span in enumerate(spans):
        raw = clean_text(span.get("text", ""))
        if not raw:
            continue
        flags = span.get("flags", 0)
        size = span.get("size", body)
        stripped = raw.strip()
        looks_marker = bool(re.fullmatch(r"[0-9]{1,3}|[\*\u2020\u2021\u00a7\u00b6]{1,2}", stripped))
        is_super = bool(flags & FLAG_SUPERSCRIPT) or size <= body * 0.82
        prev_text = "".join(parts)
        follows_word = bool(prev_text) and (prev_text[-1].isalnum() or prev_text[-1] in ".,;:)\u201d\u2019")
        if looks_marker and is_super and follows_word:
            key = footnote_key(page_label, stripped, 1)
            if key not in known:
                # Marker with no matching note on this page: keep it literal
                # rather than emit a dangling reference.
                parts.append(stripped)
                continue
            parts.append(f"[^{key}]")
            continue
        parts.append(raw)
    text = "".join(parts)
    text = re.sub(r"\s+([\.,;:\)])", r"\1", text)
    return text.strip()


# --------------------------------------------------------------------------
# Figures and tables
# --------------------------------------------------------------------------

def save_pixmap(pix: "pymupdf.Pixmap", path: str) -> bool:
    try:
        if pix.n - pix.alpha >= 4:
            pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
        pix.save(path)
        return True
    except Exception:
        return False


def extract_raster_figures(
    doc: "pymupdf.Document",
    page: "pymupdf.Page",
    page_index: int,
    lines: Sequence[Line],
    fig_dir: str,
    rel_dir: str,
    cfg: Config,
) -> List[Dict[str, Any]]:
    figures: List[Dict[str, Any]] = []
    seen_xrefs: set = set()
    counter = 0
    try:
        infos = page.get_image_info(xrefs=True)
    except Exception:
        infos = []
    page_rect = page.rect
    page_area = max(page_rect.width * page_rect.height, 1.0)
    has_text_layer = len(page.get_text("text").strip()) > 200
    for info in infos:
        xref = info.get("xref", 0)
        if not xref or xref in seen_xrefs:
            continue
        seen_xrefs.add(xref)
        bbox = info.get("bbox")
        if bbox and has_text_layer and lines:
            r = pymupdf.Rect(bbox)
            covered = sum(
                1 for ln in lines
                if r.contains(pymupdf.Rect(ln.bbox).tl)
                and r.contains(pymupdf.Rect(ln.bbox).br)
            )
            if covered / len(lines) > 0.55 or r.get_area() > page_area * 0.62:
                # The image lies under the page's own text: this is the page
                # scan, not a figure printed on the page.
                continue
        width = info.get("width", 0)
        height = info.get("height", 0)
        if width < cfg.min_image_px or height < cfg.min_image_px:
            continue
        if width and height:
            ratio = max(width, height) / max(1, min(width, height))
            if ratio > 18:      # decorative rules and hairlines
                continue
        counter += 1
        name = f"p{page_index + 1:04d}_img{counter}.png"
        out_path = os.path.join(fig_dir, name)
        ok = False
        try:
            pix = pymupdf.Pixmap(doc, xref)
            ok = save_pixmap(pix, out_path)
        except Exception:
            ok = False
        if not ok:
            try:
                raw = doc.extract_image(xref)
                ext = raw.get("ext", "png")
                name = f"p{page_index + 1:04d}_img{counter}.{ext}"
                out_path = os.path.join(fig_dir, name)
                with open(out_path, "wb") as fh:
                    fh.write(raw["image"])
                ok = True
            except Exception:
                ok = False
        if not ok:
            continue
        figures.append(
            {
                "bbox": tuple(info.get("bbox", (0, 0, 0, 0))),
                "path": f"{rel_dir}/{name}",
                "kind": "raster",
            }
        )
    return figures


def cluster_rects(rects: List["pymupdf.Rect"], pad: float = 12.0) -> List["pymupdf.Rect"]:
    """Merge nearby rectangles into figure-sized clusters."""
    clusters: List[pymupdf.Rect] = []
    for r in rects:
        grown = pymupdf.Rect(r.x0 - pad, r.y0 - pad, r.x1 + pad, r.y1 + pad)
        merged = False
        for i, c in enumerate(clusters):
            if grown.intersects(c):
                clusters[i] = c | r
                merged = True
                break
        if not merged:
            clusters.append(pymupdf.Rect(r))
    # Second sweep so chained overlaps collapse.
    changed = True
    while changed:
        changed = False
        out: List[pymupdf.Rect] = []
        for c in clusters:
            placed = False
            for i, o in enumerate(out):
                if pymupdf.Rect(c.x0 - pad, c.y0 - pad, c.x1 + pad, c.y1 + pad).intersects(o):
                    out[i] = o | c
                    placed = True
                    changed = True
                    break
            if not placed:
                out.append(c)
        clusters = out
    return clusters


def extract_vector_figures(
    page: "pymupdf.Page",
    page_index: int,
    rect: Sequence[float],
    lines: Sequence[Line],
    fig_dir: str,
    rel_dir: str,
    cfg: Config,
    taken: List[Sequence[float]],
) -> List[Dict[str, Any]]:
    try:
        drawings = page.get_drawings()
    except Exception:
        return []
    page_area = (rect[2] - rect[0]) * (rect[3] - rect[1])
    if page_area <= 0:
        return []
    raw_rects = []
    for d in drawings:
        r = d.get("rect")
        if r is None or r.is_empty:
            continue
        if r.width < 4 or r.height < 4:
            continue
        if r.width * r.height > page_area * 0.92:
            continue
        raw_rects.append(r)
    if not raw_rects:
        return []
    figures: List[Dict[str, Any]] = []
    counter = 0
    for cluster in cluster_rects(raw_rects):
        area = cluster.width * cluster.height
        if cluster.width < 70 or cluster.height < 70:
            continue
        if area < page_area * 0.035 or area > page_area * 0.85:
            continue
        if any(horizontal_overlap(cluster, t) > 0.6 and
               abs(cluster.y0 - t[1]) < 24 for t in taken):
            continue
        # Skip clusters that are really just a block of text with a box round it.
        inside = [
            ln for ln in lines
            if pymupdf.Rect(ln.bbox).intersects(cluster)
            and pymupdf.Rect(ln.bbox).get_area() > 0
        ]
        text_chars = sum(len(ln.text) for ln in inside)
        if text_chars > 400:
            continue
        counter += 1
        name = f"p{page_index + 1:04d}_fig{counter}.png"
        out_path = os.path.join(fig_dir, name)
        clip = pymupdf.Rect(cluster) & pymupdf.Rect(rect)
        try:
            pix = page.get_pixmap(clip=clip, dpi=max(200, cfg.dpi))
        except Exception:
            continue
        if not save_pixmap(pix, out_path):
            continue
        figures.append(
            {
                "bbox": (clip.x0, clip.y0, clip.x1, clip.y1),
                "path": f"{rel_dir}/{name}",
                "kind": "vector",
            }
        )
    return figures


def attach_captions(
    figures: List[Dict[str, Any]],
    lines: Sequence[Line],
    available: List[int],
) -> None:
    """Give each figure a caption and mark the caption lines as consumed."""
    used: set = set()
    for fig in figures:
        fb = fig["bbox"]
        best: Optional[Tuple[float, int]] = None
        for i in available:
            if i in used:
                continue
            line = lines[i]
            if not CAPTION_RE.match(line.text):
                continue
            if horizontal_overlap(fb, line.bbox) < 0.25:
                continue
            below = line.bbox[1] - fb[3]
            above = fb[1] - line.bbox[3]
            if 0 <= below <= 90:
                score = below
            elif 0 <= above <= 70:
                score = above + 25       # prefer captions underneath
            else:
                continue
            if best is None or score < best[0]:
                best = (score, i)
        if best is None:
            continue
        _, idx = best
        used.add(idx)
        caption_lines = [lines[idx].text.strip()]
        # Pull in continuation lines directly beneath the caption.
        cursor = idx
        while True:
            nxt = cursor + 1
            if nxt >= len(lines) or nxt not in available or nxt in used:
                break
            cand = lines[nxt]
            if cand.size > lines[idx].size + 0.6:
                break
            if cand.bbox[1] - lines[cursor].bbox[3] > lines[idx].size * 1.4:
                break
            if CAPTION_RE.match(cand.text):
                break
            if horizontal_overlap(lines[idx].bbox, cand.bbox) < 0.3:
                break
            caption_lines.append(cand.text.strip())
            used.add(nxt)
            cursor = nxt
            if cand.text.strip().endswith(SENTENCE_END):
                break
        caption = ""
        for chunk in caption_lines:
            caption = dehyphenate_join(caption, chunk)
        fig["caption"] = caption.strip()
        fig["caption_indices"] = sorted(used)

    for fig in figures:
        for i in fig.get("caption_indices", []):
            if i in available:
                available.remove(i)
        fig.pop("caption_indices", None)


def table_is_plausible(rows: Sequence[str]) -> bool:
    """Screen out 'tables' that are really chart furniture or a text block.

    Three symptoms are decisive: cells that repeat identically across a row,
    cells long enough to be paragraphs, and rows that are nearly all empty.
    """
    parsed: List[List[str]] = []
    for row in rows:
        cells = [c.strip() for c in row.strip().strip("|").split("|")]
        if all(set(c) <= {"-", ":", " "} for c in cells if c):
            continue                     # the header separator row
        parsed.append(cells)
    if len(parsed) < 2:
        return False

    duplicated_rows = 0
    long_cells = 0
    empty_rows = 0
    total_cells = 0
    for cells in parsed:
        filled = [c for c in cells if c]
        total_cells += len(cells)
        if not filled:
            empty_rows += 1
            continue
        if len(filled) > 1 and len(set(filled)) == 1:
            duplicated_rows += 1
        long_cells += sum(1 for c in filled if len(c) > 220)

    if duplicated_rows / len(parsed) > 0.4:
        return False
    if empty_rows / len(parsed) > 0.5:
        return False
    if total_cells and long_cells / total_cells > 0.15:
        return False
    return True


def extract_tables(
    page: "pymupdf.Page", lines: Sequence[Line], available: List[int], cfg: Config
) -> List[Dict[str, Any]]:
    if not cfg.detect_tables:
        return []
    try:
        finder = page.find_tables()
        tables = list(finder.tables)
    except Exception:
        return []
    out: List[Dict[str, Any]] = []
    for table in tables:
        try:
            md = table.to_markdown()
        except Exception:
            continue
        if not md or md.count("|") < 6:
            continue
        bbox = tuple(table.bbox)
        rows = [r for r in md.splitlines() if r.strip()]
        if len(rows) < 3:
            continue
        if not table_is_plausible(rows):
            continue
        out.append({"bbox": bbox, "markdown": md.strip()})
        trect = pymupdf.Rect(bbox)
        for i in list(available):
            if trect.contains(pymupdf.Rect(lines[i].bbox).tl) and trect.intersects(
                pymupdf.Rect(lines[i].bbox)
            ):
                available.remove(i)
    return out


# --------------------------------------------------------------------------
# Page assembly
# --------------------------------------------------------------------------

BULLET_RE = re.compile(r"^\s*([\u2022\u2023\u25cf\u25aa\u00b7\u2013\u2014\-\*])\s+")
NUMBERED_RE = re.compile(r"^\s*(\d{1,2}|[a-z]|[ivx]{1,4})[\.\)]\s+")


SECTION_NUMBER_RE = re.compile(r"^[A-Z]?\d{1,2}(\.\d{1,2})*\.?$")


def is_all_caps(text: str) -> bool:
    letters = [c for c in text if c.isalpha()]
    if len(letters) < 3:
        return False
    upper = sum(1 for c in letters if c.isupper())
    return upper / len(letters) >= 0.9


def line_is_heading(
    line: Line, body: float, scale: Dict[float, int], cfg: Config
) -> Optional[int]:
    size = round(line.size * 2) / 2
    text = line.text.strip()
    deepest = max(scale.values(), default=2)

    # A long line is running prose no matter how it is set.
    too_long = len(text) > 120

    if not too_long:
        if size in scale:
            return scale[size]
        for known, level in sorted(scale.items(), reverse=True):
            if abs(size - known) <= 0.4:
                return level

    if too_long:
        return None
    if BULLET_RE.match(text):
        return None

    # Small-caps or full-caps run-in heads set at body size.
    if (
        is_all_caps(text)
        and size >= body - 0.3
        and len(text) <= 90
        and len(text.split()) <= 14
        and not text.endswith((".", ",", ";"))
    ):
        return min(deepest + 1, 6)

    if SECTION_NUMBER_RE.match(text):
        return min(deepest + 1, 6)

    if not cfg.bold_headings:
        return None
    if (
        line.bold
        and size >= body - 0.3
        and 2 < len(text) <= 80
        and not text.endswith((".", ",", ";"))
    ):
        return min(deepest + 1, 6)
    return None


def build_page_units(
    lines: Sequence[Line],
    available: List[int],
    body: float,
    scale: Dict[float, int],
    split: Optional[float],
    page_label: str,
    footnote_keys: set,
    cfg: Config,
) -> List[Unit]:
    """Group the remaining lines into paragraphs, headings and lists."""
    units: List[Unit] = []
    ordered = sorted(available, key=lambda i: (column_of(lines[i].bbox, split), lines[i].bbox[1], lines[i].bbox[0]))

    current: Optional[Dict[str, Any]] = None

    def flush() -> None:
        nonlocal current
        if current is None:
            return
        text = current["text"].strip()
        if text:
            units.append(
                Unit(
                    kind=current["kind"],
                    text=text,
                    bbox=tuple(current["bbox"]),
                    column=current["column"],
                    level=current["level"],
                    ends_open=not text.endswith(SENTENCE_END),
                )
            )
        current = None

    prev: Optional[Line] = None
    for i in ordered:
        line = lines[i]
        text = inline_footnote_refs(line, body, page_label, footnote_keys)
        if not text:
            continue
        level = line_is_heading(line, body, scale, cfg)
        col = column_of(line.bbox, split)

        is_list = bool(BULLET_RE.match(text)) or bool(NUMBERED_RE.match(text))

        new_block = False
        if current is None:
            new_block = True
        elif level is not None or current["kind"] == "heading":
            new_block = True
        elif col != current["column"]:
            new_block = True
        elif is_list:
            new_block = True
        elif prev is not None:
            gap = line.bbox[1] - prev.bbox[3]
            leading = max(line.size, prev.size)
            if gap > leading * 0.85:
                new_block = True
            elif line.bbox[0] - prev.bbox[0] > leading * 1.1 and prev.text.strip().endswith(SENTENCE_END):
                new_block = True     # first-line indent starts a paragraph
            elif abs(line.size - prev.size) > 1.2:
                new_block = True

        if new_block:
            flush()
            kind = "heading" if level is not None else ("list" if is_list else "paragraph")
            current = {
                "kind": kind,
                "text": text,
                "bbox": list(line.bbox),
                "column": col,
                "level": level or 0,
            }
        else:
            current["text"] = dehyphenate_join(current["text"], text)
            bb = current["bbox"]
            current["bbox"] = [
                min(bb[0], line.bbox[0]),
                min(bb[1], line.bbox[1]),
                max(bb[2], line.bbox[2]),
                max(bb[3], line.bbox[3]),
            ]
        prev = line

    flush()
    return merge_heading_fragments(units)


def merge_heading_fragments(units: List[Unit]) -> List[Unit]:
    """Rejoin headings that the layout split across lines or columns.

    Two cases matter: a bare section number sitting on its own line above the
    title, and a title set over two or three lines at the same size.
    """
    merged: List[Unit] = []
    for unit in units:
        if not merged:
            merged.append(unit)
            continue
        prev = merged[-1]
        if prev.kind != "heading" or unit.kind != "heading":
            merged.append(unit)
            continue

        prev_is_number = bool(SECTION_NUMBER_RE.match(prev.text.strip()))
        same_level = prev.level == unit.level
        close = abs(unit.bbox[1] - prev.bbox[3]) < max(unit.bbox[3] - unit.bbox[1], 6) * 2.2
        same_column = prev.column == unit.column
        short_enough = len(prev.text) + len(unit.text) < 200
        open_ended = not prev.text.rstrip().endswith((".", "?", "!"))

        if prev_is_number and same_column and close:
            prev.text = f"{prev.text.rstrip('.')} {unit.text}".strip()
            prev.level = min(prev.level, unit.level) or unit.level
            prev.bbox = (
                min(prev.bbox[0], unit.bbox[0]),
                min(prev.bbox[1], unit.bbox[1]),
                max(prev.bbox[2], unit.bbox[2]),
                max(prev.bbox[3], unit.bbox[3]),
            )
            continue

        if same_level and same_column and close and short_enough and open_ended:
            prev.text = dehyphenate_join(prev.text, unit.text)
            prev.bbox = (
                min(prev.bbox[0], unit.bbox[0]),
                min(prev.bbox[1], unit.bbox[1]),
                max(prev.bbox[2], unit.bbox[2]),
                max(prev.bbox[3], unit.bbox[3]),
            )
            continue

        merged.append(unit)
    return merged


def units_to_markdown(units: Sequence[Unit]) -> str:
    chunks: List[str] = []
    for unit in units:
        if unit.kind == "heading":
            level = min(max(unit.level, 1), 6)
            chunks.append("#" * level + " " + unit.text)
        elif unit.kind == "list":
            text = unit.text
            m = BULLET_RE.match(text)
            if m:
                text = "- " + text[m.end():]
            else:
                m2 = NUMBERED_RE.match(text)
                if m2:
                    text = f"{m2.group(1)}. " + text[m2.end():]
            chunks.append(text)
        elif unit.kind == "figure":
            chunks.append(unit.text)
        elif unit.kind == "table":
            chunks.append(unit.text)
        else:
            chunks.append(unit.text)
    return "\n\n".join(chunks)


def process_page(
    doc: "pymupdf.Document",
    page_index: int,
    lines: List[Line],
    chrome_indices: Sequence[int],
    page_label: str,
    body: float,
    scale: Dict[float, int],
    fig_dir: str,
    rel_dir: str,
    cfg: Config,
    fragmented: bool = False,
    preset_split: Optional[float] = None,
) -> PageResult:
    page = doc[page_index]
    rect = tuple(page.rect)
    available = [i for i in range(len(lines)) if i not in set(chrome_indices)]

    tables = extract_tables(page, lines, available, cfg)

    footnote_indices = detect_footnote_lines(page, lines, rect, body, available)
    for i in footnote_indices:
        if i in available:
            available.remove(i)
    footnotes = group_footnotes(lines, footnote_indices, page_label)
    footnote_keys = {k for k, _ in footnotes}

    figures: List[Dict[str, Any]] = []
    if cfg.extract_figures:
        figures.extend(
            extract_raster_figures(doc, page, page_index, lines, fig_dir, rel_dir, cfg)
        )
        if cfg.extract_vector_figures:
            taken = [f["bbox"] for f in figures] + [t["bbox"] for t in tables]
            figures.extend(
                extract_vector_figures(
                    page, page_index, rect, lines, fig_dir, rel_dir, cfg, taken
                )
            )
        attach_captions(figures, lines, available)

    # Prefer the split measured on raw OCR fragments during consolidation —
    # hundreds of samples beat the ~hundred merged lines available here.
    avail_lines = [lines[i] for i in available]
    split = preset_split
    if split is None:
        split = detect_column_split(avail_lines, rect)
    if split is None:
        # Edge-based detection dies on one centred stamp or watermark
        # crossing the gutter; the crossing-count scan tolerates those.
        split = robust_column_split(avail_lines, rect)

    units = build_page_units(
        lines, available, body, scale, split, page_label, footnote_keys, cfg
    )

    for table in tables:
        units.append(
            Unit(
                kind="table",
                text=table["markdown"],
                bbox=tuple(table["bbox"]),
                column=column_of(table["bbox"], split),
            )
        )

    for fig in figures:
        caption = fig.get("caption", "")
        alt = caption or "Figure"
        alt = alt.replace("[", "(").replace("]", ")")
        md = f"![{alt}]({fig['path']})"
        if caption:
            md += f"\n\n*{caption}*"
        units.append(
            Unit(
                kind="figure",
                text=md,
                bbox=tuple(fig["bbox"]),
                column=column_of(fig["bbox"], split),
            )
        )

    units.sort(key=lambda u: (u.column, round(u.bbox[1], 1), u.bbox[0]))

    char_count = sum(len(u.text) for u in units)
    # A page needs the model to read the image when there is (almost) no text
    # layer at all, or when the layer was a shattered scan-OCR overlay: the
    # reassembled fragments are readable but word order and spacing inside
    # them are only as good as the scan's own OCR, so a fresh transcription
    # from the page image beats verifying against them.
    needs_ocr = char_count < 60 or fragmented

    return PageResult(
        index=page_index,
        label=page_label,
        units=units,
        footnotes=footnotes,
        rect=rect,
        char_count=char_count,
        needs_ocr=needs_ocr,
        image_paths=[f["path"] for f in figures],
    )


# --------------------------------------------------------------------------
# OpenRouter passes
# --------------------------------------------------------------------------

VERIFY_SYSTEM = """You repair Markdown that was mechanically extracted from a single PDF page.
You are given the page image and the draft Markdown for that same page.

Rules, all mandatory:
1. Output ONLY the corrected Markdown for this page. No preamble, no code fence, no commentary.
2. Never invent content. Every word must be visible on the page image.
3. Keep every line that starts with `![` exactly as it is, character for character, and keep it in the same relative position.
4. Keep every footnote reference `[^key]` and every footnote definition `[^key]:` with the same keys. Add a reference only if the page image clearly shows a marker the draft missed, and only using a key that already exists in the draft's definitions.
5. Fix heading levels so they match the visual hierarchy on the page. Use `#` through `####`.
6. Fix reading order for multi-column layouts. Body text runs down the left column, then down the right.
7. Rejoin words broken across line ends. Remove running heads, running feet and bare page numbers if any survived.
8. Render tables as Markdown tables. Render displayed equations as `$$...$$` and inline maths as `$...$`.
9. Preserve italics and bold where the page shows them. Do not restyle prose, do not summarise, do not modernise spelling.
10. If the draft is already correct, return it unchanged."""

OCR_SYSTEM = """You transcribe a single scanned PDF page into Markdown.

Rules, all mandatory:
1. Output ONLY Markdown for this page. No preamble, no code fence, no commentary.
2. Transcribe every word you can read, in natural reading order. Multi-column pages run column by column.
3. Do not summarise, do not paraphrase, do not correct the author's spelling.
4. Use `#` through `####` for headings that match the visual hierarchy.
5. Omit running heads, running feet, bare page numbers, and library or archive download stamps and watermarks (for example JSTOR's "This content downloaded from..." and "All use subject to..." lines).
6. Footnotes at the foot of the page become Markdown footnote definitions using the key prefix given in the user message, for example `[^p12-3]: note text`. Put the matching `[^p12-3]` reference at the exact point in the body text where the superscript marker appears.
7. Render tables as Markdown tables, equations as `$$...$$` or `$...$`.
8. If a word is illegible, write `[illegible]`. Never guess."""


def render_page_png(doc: "pymupdf.Document", index: int, dpi: int) -> bytes:
    page = doc[index]
    pix = page.get_pixmap(dpi=dpi)
    if pix.n - pix.alpha >= 4:
        pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
    return pix.tobytes("png")


def call_openrouter(
    cfg: Config,
    model: str,
    system: str,
    user_text: str,
    image_png: bytes,
    temperature: Optional[float] = None,
) -> Tuple[Optional[str], Dict[str, int]]:
    """Return (text, usage). usage is empty when the call failed.

    temperature overrides cfg.temperature for this one call — used by the
    OCR retry, where a nonzero temperature helps escape repetition loops."""
    if requests is None:
        raise RuntimeError("requests is not installed: pip3 install requests --break-system-packages")
    if not cfg.api_key:
        raise RuntimeError("OPENROUTER_API_KEY is not set")

    b64 = base64.b64encode(image_png).decode("ascii")
    payload = {
        "model": model,
        "temperature": cfg.temperature if temperature is None else temperature,
        "messages": [
            {"role": "system", "content": system},
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
                    {"type": "text", "text": user_text},
                ],
            },
        ],
    }
    headers = {
        "Authorization": f"Bearer {cfg.api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://postliterate.org",
        "X-Title": "PostLiterate pdf_to_markdown",
    }

    delay = 2.0
    for attempt in range(cfg.max_retries):
        try:
            r = requests.post(OPENROUTER_URL, headers=headers, json=payload, timeout=300)
            if r.status_code in (429, 500, 502, 503, 504):
                time.sleep(delay)
                delay *= 2
                continue
            r.raise_for_status()
            data = r.json()
            usage_raw = data.get("usage") or {}
            usage = {
                "prompt_tokens": int(usage_raw.get("prompt_tokens") or 0),
                "completion_tokens": int(usage_raw.get("completion_tokens") or 0),
                "total_tokens": int(usage_raw.get("total_tokens") or 0),
            }
            cost = usage_raw.get("cost")
            if cost is not None:
                try:
                    usage["cost_micros"] = int(round(float(cost) * 1_000_000))
                except (TypeError, ValueError):
                    pass
            choices = data.get("choices") or []
            if not choices:
                return None, usage
            content = choices[0].get("message", {}).get("content")
            if isinstance(content, list):
                content = "".join(
                    part.get("text", "") for part in content if isinstance(part, dict)
                )
            return (content or "").strip(), usage
        except Exception:
            if attempt == cfg.max_retries - 1:
                return None, {}
            time.sleep(delay)
            delay *= 2
    return None, {}


def strip_fences(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```[a-zA-Z]*\s*\n", "", t)
        t = re.sub(r"\n```\s*$", "", t)
    return t.strip()


def looks_degenerate(text: str) -> bool:
    """Detect repetition collapse in model output.

    Long vision-model generations at temperature 0 can fall into a token
    loop mid-page and emit tens of thousands of characters of the same few
    tokens before recovering. Such output compresses absurdly well and is
    dominated by a single word; readable prose compresses to ~0.4-0.5 of
    its size and no word exceeds ~10% of the text."""
    if len(text) < 2000:
        return False
    raw = text.encode("utf-8")
    if len(zlib.compress(raw, 6)) / len(raw) < 0.10:
        return True
    words = [w for w in text.split() if any(c.isalnum() for c in w)]
    if len(words) > 60:
        top = Counter(words).most_common(1)[0][1]
        if top > 0.30 * len(words):
            return True
    return False


def transcription_is_sane(out: str, draft: str) -> bool:
    """Gate a whole-page OCR transcription before it replaces the draft."""
    if not out or len(out) < 20:
        return False
    if looks_degenerate(out):
        return False
    # A transcription of the same page should not dwarf the mechanical
    # extraction. The 2.5x headroom covers footnote expansion and tables;
    # a degeneration loop overshoots it several times over.
    if draft and len(draft) > 800 and len(out) > 2.5 * len(draft):
        return False
    return True


def verification_is_safe(original: str, revised: str, image_lines: Sequence[str]) -> bool:
    if not revised:
        return False
    if looks_degenerate(revised):
        return False
    low = revised.lower()
    for bad in ("i cannot", "i'm unable", "as an ai", "sorry, i can", "no text is visible"):
        if low.startswith(bad):
            return False
    for line in image_lines:
        if line not in revised:
            return False
    if original:
        ratio = len(revised) / max(1, len(original))
        if ratio < 0.55 or ratio > 2.6:
            return False
    return True


def verify_page(
    cfg: Config,
    doc_path: str,
    result: PageResult,
    draft: str,
) -> Tuple[int, Optional[str], str, Dict[str, int]]:
    """Run one page through the VLM. Returns (index, revised, status, usage)."""
    doc = pymupdf.open(doc_path)
    try:
        png = render_page_png(doc, result.index, cfg.dpi)
    finally:
        doc.close()

    image_lines = [ln for ln in draft.splitlines() if ln.strip().startswith("![")]

    if result.needs_ocr and cfg.ocr_mode != "off":
        user = (
            f"Transcribe this page. Use the footnote key prefix `p{result.label}-` "
            f"for any footnotes, for example `[^p{result.label}-1]`."
        )
        # Two attempts: the retry runs at nonzero temperature, which is
        # usually enough to escape a repetition loop the first attempt fell
        # into. If neither attempt is sane, keep the mechanical draft.
        total_usage: Dict[str, int] = {}
        api_failures = 0
        for attempt in range(2):
            out, usage = call_openrouter(
                cfg,
                cfg.ocr_model,
                OCR_SYSTEM,
                user,
                png,
                temperature=None if attempt == 0 else max(cfg.temperature, 0.5),
            )
            for key, value in usage.items():
                total_usage[key] = total_usage.get(key, 0) + value
            if out is None:
                api_failures += 1
                continue
            out = strip_fences(out)
            if transcription_is_sane(out, draft):
                return result.index, out, "ocr", total_usage
        status = "api-error" if api_failures == 2 else "ocr-failed"
        return result.index, None, status, total_usage

    if not cfg.verify:
        return result.index, None, "skipped", {}

    user = (
        "Draft Markdown extracted from this page:\n\n"
        "-----BEGIN DRAFT-----\n"
        f"{draft}\n"
        "-----END DRAFT-----\n\n"
        "Return the corrected Markdown for this page only."
    )
    out, usage = call_openrouter(cfg, cfg.verify_model, VERIFY_SYSTEM, user, png)
    if out is None:
        # The call itself failed (auth, credit, network, provider outage).
        # Report that as its own status — calling it "rejected" would blame
        # the model for output it never produced.
        return result.index, None, "api-error", usage
    out = strip_fences(out)
    if verification_is_safe(draft, out, image_lines):
        return result.index, out, "verified", usage
    return result.index, None, "rejected", usage


BIBLIO_SYSTEM = """You are a research librarian reading the opening page of a document.
Return ONLY a JSON object, no code fence and no commentary, with these keys:

{
  "title": "full title as printed",
  "author": "authors as printed, comma separated",
  "year": 2024,
  "source_type": "paper|book|chapter|report|essay|article",
  "publisher": "journal, press or conference",
  "doi": "10.xxxx/xxxx or null",
  "url": "canonical url or null",
  "tags": ["three", "to", "six", "lowercase-kebab-case", "topic tags"],
  "canonical_filename": "AuthorYear_ShortTitle.pdf"
}

Use null for anything not visible on the page. Never invent a DOI or a URL.
canonical_filename uses the first author's surname, the year, and two to four
CamelCase words from the title."""


def extract_bibliography(
    cfg: Config, doc_path: str, first_page_index: int = 0
) -> Dict[str, Any]:
    """Ask the model to read the title page. Returns {} if unavailable."""
    if not cfg.api_key:
        return {}
    doc = pymupdf.open(doc_path)
    try:
        png = render_page_png(doc, first_page_index, min(cfg.dpi, 180))
    finally:
        doc.close()
    out, _usage = call_openrouter(
        cfg, cfg.verify_model, BIBLIO_SYSTEM, "Extract the metadata.", png
    )
    if not out:
        return {}
    out = strip_fences(out)
    match = re.search(r"\{.*\}", out, re.DOTALL)
    if not match:
        return {}
    try:
        return json.loads(match.group())
    except json.JSONDecodeError:
        return {}


# --------------------------------------------------------------------------
# Document assembly
# --------------------------------------------------------------------------

def page_marker(label: str, mode: str) -> str:
    if mode == "none":
        return ""
    if mode == "visible":
        return f"**[p. {label}]**"
    return f"<!-- page {label} -->"


def render_footnote_block(footnotes: Sequence[Tuple[str, str]]) -> str:
    return "\n\n".join(f"[^{key}]: {text}" for key, text in footnotes if text)


# Library/archive download stamps that model transcriptions faithfully read
# off the page image. The mechanical path drops these via repeat-based chrome
# detection; this filter covers the model paths (and is harmless elsewhere).
STAMP_RE = re.compile(
    r"^\s*(?:"
    r"this content downloaded from\b"
    r"|all use subject to\b.{0,80}(?:terms|conditions)"
    r"|downloaded from https?://\S+ on\b"
    r")",
    re.IGNORECASE,
)


def strip_stamp_lines(text: str) -> str:
    kept = [ln for ln in text.splitlines() if not STAMP_RE.match(ln)]
    return "\n".join(kept)


def assemble_document(
    results: Sequence[PageResult],
    page_markdown: Dict[int, str],
    cfg: Config,
) -> str:
    parts: List[str] = []
    all_notes: List[Tuple[str, str]] = []
    pending_open = False

    for result in results:
        body = strip_stamp_lines(page_markdown.get(result.index, "")).strip()
        marker = page_marker(result.label, cfg.page_markers)

        if cfg.footnote_placement == "page" and result.footnotes:
            note_block = render_footnote_block(result.footnotes)
        else:
            note_block = ""
            all_notes.extend(result.footnotes)

        chunk = body
        if note_block:
            chunk = (chunk + "\n\n" + note_block).strip()

        if not chunk and not marker:
            continue

        if pending_open and parts and chunk and cfg.join_pages:
            first_break = chunk.find("\n\n")
            head = chunk if first_break == -1 else chunk[:first_break]
            rest = "" if first_break == -1 else chunk[first_break + 2:]
            head_stripped = head.lstrip()
            joinable = (
                head_stripped
                and not head_stripped.startswith(("#", "|", "!", "-", ">", "[^"))
                and (head_stripped[0].islower() or head_stripped[0] in "\u201c\u2018(")
            )
            if joinable:
                if marker:
                    parts.append(marker)
                parts[-2 if marker else -1] = dehyphenate_join(
                    parts[-2 if marker else -1], head_stripped
                )
                if rest.strip():
                    parts.append(rest.strip())
                pending_open = bool(rest.strip()) and not rest.strip().endswith(SENTENCE_END)
                if not rest.strip():
                    pending_open = not parts[-2 if marker else -1].endswith(SENTENCE_END)
                continue

        if marker:
            parts.append(marker)
        if chunk:
            parts.append(chunk)
        pending_open = bool(chunk) and not chunk.rstrip().endswith(SENTENCE_END) and "\n" not in chunk[-60:].strip()

    text = "\n\n".join(p for p in parts if p is not None)

    if cfg.footnote_placement == "end" and all_notes:
        seen: set = set()
        deduped: List[Tuple[str, str]] = []
        for key, note in all_notes:
            k = key
            n = 2
            while k in seen:
                k = f"{key}x{n}"
                n += 1
            seen.add(k)
            deduped.append((k, note))
        text = text.rstrip() + "\n\n## Notes\n\n" + render_footnote_block(deduped) + "\n"

    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    return text.strip() + "\n"


def build_frontmatter(
    pdf_path: str,
    meta: Dict[str, Any],
    results: Sequence[PageResult],
    cfg: Config,
    statuses: Counter,
) -> str:
    today = datetime.date.today().isoformat()
    labels = [r.label for r in results]
    title = (meta.get("title") or "").strip() or os.path.splitext(os.path.basename(pdf_path))[0]
    author = (meta.get("author") or "").strip()

    tooling = ["pymupdf"]
    if statuses.get("verified"):
        tooling.append(f"verify:{cfg.verify_model}")
    if statuses.get("ocr"):
        tooling.append(f"ocr:{cfg.ocr_model}")

    lines = [
        "---",
        "type: conversion",
        f'title: "{title.replace(chr(34), chr(39))}"',
        f'author: "{author.replace(chr(34), chr(39))}"',
        f'source_pdf: "{os.path.basename(pdf_path)}"',
        f"pages: {len(results)}",
        f'page_range: "{labels[0] if labels else ""}-{labels[-1] if labels else ""}"',
        f"converted: {today}",
        f'tooling: "{", ".join(tooling)}"',
        f"pages_verified: {statuses.get('verified', 0)}",
        f"pages_ocr: {statuses.get('ocr', 0)}",
        f"pages_rejected: {statuses.get('rejected', 0)}",
        f"pages_api_errors: {statuses.get('api-error', 0)}",
        "status: unverified-by-human",
        "---",
        "",
    ]
    return "\n".join(lines)


# --------------------------------------------------------------------------
# Driver
# --------------------------------------------------------------------------

def parse_page_range(spec: Optional[str], total: int) -> List[int]:
    if not spec:
        return list(range(total))
    out: List[int] = []
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, _, b = part.partition("-")
            start = int(a) if a.strip() else 1
            end = int(b) if b.strip() else total
        else:
            start = end = int(part)
        for n in range(start, end + 1):
            if 1 <= n <= total:
                out.append(n - 1)
    return sorted(set(out)) or list(range(total))


class Cancelled(Exception):
    """Raised when a caller asks for the job to stop."""


def convert_pdf(
    pdf_path: str,
    out_path: str,
    cfg: Config,
    page_spec: Optional[str],
    on_progress: Optional[Any] = None,
    should_cancel: Optional[Any] = None,
) -> Dict[str, Any]:
    """Convert one PDF. Returns a result dict describing what was produced.

    on_progress receives dicts like {"stage": "verify", "done": 12, "total": 35}.
    should_cancel is polled between stages and between model pages.
    """

    def emit(stage: str, **fields: Any) -> None:
        if on_progress:
            payload = {"stage": stage}
            payload.update(fields)
            on_progress(payload)

    def check_cancel() -> None:
        if should_cancel and should_cancel():
            raise Cancelled()

    doc = pymupdf.open(pdf_path)
    total = doc.page_count
    indices = parse_page_range(page_spec, total)
    log(cfg, f"\n{os.path.basename(pdf_path)}: {total} pages, converting {len(indices)}")
    emit("open", pages_total=total, pages_selected=len(indices))

    stem = os.path.splitext(os.path.basename(out_path))[0]
    out_dir = os.path.dirname(os.path.abspath(out_path))
    rel_dir = f"figures/{stem}"
    fig_dir = os.path.join(out_dir, "figures", stem)
    if cfg.extract_figures:
        os.makedirs(fig_dir, exist_ok=True)

    # Running heads only reveal themselves by repeating. When only a slice is
    # requested, sample the wider document so the slice still gets cleaned.
    analysis_indices = set(indices)
    if len(indices) < 10 and total > len(indices):
        step = max(1, total // 24)
        analysis_indices.update(range(0, total, step))

    page_lines: Dict[int, List[Line]] = {}
    page_rects: Dict[int, Tuple[float, float, float, float]] = {}
    page_fragmented: Dict[int, bool] = {}
    page_splits: Dict[int, Optional[float]] = {}
    for idx in sorted(analysis_indices):
        lines, _, fragmented, frag_split = collect_lines(doc[idx])
        page_lines[idx] = lines
        page_rects[idx] = tuple(doc[idx].rect)
        page_fragmented[idx] = fragmented
        page_splits[idx] = frag_split

    chrome, labels = detect_chrome(page_lines, page_rects)
    body = body_font_size(page_lines)
    scale = heading_scale(page_lines, body)
    log(cfg, f"  body type {body}pt; heading sizes {sorted(scale, reverse=True) or 'none detected'}")
    emit("analysed", body_size=body, heading_sizes=sorted(scale, reverse=True))

    results: List[PageResult] = []
    for position, idx in enumerate(indices, start=1):
        check_cancel()
        label = labels.get(idx) or str(idx + 1)
        results.append(
            process_page(
                doc,
                idx,
                page_lines[idx],
                chrome.get(idx, []),
                label,
                body,
                scale,
                fig_dir,
                rel_dir,
                cfg,
                fragmented=page_fragmented.get(idx, False),
                preset_split=page_splits.get(idx),
            )
        )
        emit("extract", done=position, total=len(indices), label=label)

    page_markdown: Dict[int, str] = {}
    for result in results:
        page_markdown[result.index] = units_to_markdown(result.units)

    statuses: Counter = Counter()
    totals_usage: Dict[str, int] = {}
    rejected_indices: set = set()
    ocr_pages = [r for r in results if r.needs_ocr]
    if ocr_pages and cfg.ocr_mode == "off":
        log(cfg, f"  {len(ocr_pages)} pages have no reliable text layer and OCR is off")

    needs_model = []
    for result in results:
        wants_ocr = result.needs_ocr and cfg.ocr_mode in ("auto", "force")
        wants_verify = cfg.verify
        if cfg.ocr_mode == "force":
            wants_ocr = True
        if wants_ocr or wants_verify:
            needs_model.append(result)

    if needs_model and cfg.api_key:
        log(cfg, f"  sending {len(needs_model)} pages to {cfg.verify_model}")
        emit("verify", done=0, total=len(needs_model), model=cfg.verify_model)
        cancelled = False
        with ThreadPoolExecutor(max_workers=cfg.workers) as pool:
            futures = {
                pool.submit(verify_page, cfg, pdf_path, r, page_markdown[r.index]): r
                for r in needs_model
            }
            done = 0
            for fut in as_completed(futures):
                idx, revised, status, usage = fut.result()
                statuses[status] += 1
                if status in ("rejected", "ocr-failed", "api-error"):
                    rejected_indices.add(idx)
                for key, value in usage.items():
                    totals_usage[key] = totals_usage.get(key, 0) + value
                if revised:
                    page_markdown[idx] = revised
                done += 1
                emit(
                    "verify",
                    done=done,
                    total=len(futures),
                    status=status,
                    tokens=totals_usage.get("total_tokens", 0),
                    cost_micros=totals_usage.get("cost_micros", 0),
                )
                if done % 5 == 0 or done == len(futures):
                    log(cfg, f"    {done}/{len(futures)} pages returned")
                if should_cancel and should_cancel():
                    cancelled = True
                    for pending in futures:
                        pending.cancel()
                    break
        if cancelled:
            raise Cancelled()
        if statuses.get("rejected"):
            log(cfg, f"  {statuses['rejected']} page(s) rejected, heuristic output kept")
        if statuses.get("api-error"):
            log(cfg, f"  {statuses['api-error']} page(s) hit API errors, heuristic output kept")
    elif needs_model and not cfg.api_key:
        log(cfg, "  OPENROUTER_API_KEY not set: skipping the model pass")
        emit("verify-skipped", reason="no api key")

    meta = doc.metadata or {}
    doc.close()

    body_md = assemble_document(results, page_markdown, cfg)
    front = build_frontmatter(pdf_path, meta, results, cfg, statuses)

    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write(front + body_md)

    if cfg.sidecar:
        sidecar_path = os.path.splitext(out_path)[0] + ".pages.json"
        payload = [
            {
                "index": r.index,
                "label": r.label,
                "chars": r.char_count,
                "figures": r.image_paths,
                "footnotes": [k for k, _ in r.footnotes],
                "markdown": page_markdown.get(r.index, ""),
            }
            for r in results
        ]
        with open(sidecar_path, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=2, ensure_ascii=False)
        log(cfg, f"  sidecar: {sidecar_path}")

    figures_count = sum(len(r.image_paths) for r in results)
    notes_count = sum(len(r.footnotes) for r in results)
    log(
        cfg,
        f"  wrote {out_path} ({len(body_md):,} chars, {figures_count} figures, {notes_count} footnotes)",
    )
    summary = {
        "markdown_path": out_path,
        "figures_dir": fig_dir if cfg.extract_figures else None,
        "pages_total": total,
        "pages_converted": len(results),
        "page_labels": [r.label for r in results],
        "characters": len(body_md),
        "figures": figures_count,
        "footnotes": notes_count,
        "verified": statuses.get("verified", 0),
        "rejected": statuses.get("rejected", 0),
        "ocr": statuses.get("ocr", 0),
        "ocr_failed": statuses.get("ocr-failed", 0),
        "api_errors": statuses.get("api-error", 0),
        "rejected_pages": [
            r.label for r in results if r.index in rejected_indices
        ],
        "tokens": totals_usage.get("total_tokens", 0),
        "cost_micros": totals_usage.get("cost_micros", 0),
        "pdf_metadata": meta,
    }
    emit("done", **{k: v for k, v in summary.items() if k != "pdf_metadata"})
    return summary


def gather_inputs(target: str) -> List[str]:
    if os.path.isdir(target):
        return sorted(
            os.path.join(target, f)
            for f in os.listdir(target)
            if f.lower().endswith(".pdf") and os.path.isfile(os.path.join(target, f))
        )
    return [target]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Convert PDFs to high-fidelity Markdown, with optional VLM verification."
    )
    parser.add_argument("input", help="PDF file or a directory of PDFs")
    parser.add_argument("-o", "--output", help="output .md path (single file input only)")
    parser.add_argument("--out-dir", help="output directory (defaults to alongside the PDF)")
    parser.add_argument("--pages", help="page range, e.g. 1-20 or 4,9,15-18")
    parser.add_argument("--dpi", type=int, default=200, help="render dpi for figures and the model pass")
    parser.add_argument(
        "--page-markers",
        choices=["comment", "visible", "none"],
        default="comment",
        help="how printed page numbers are preserved",
    )
    parser.add_argument(
        "--footnotes",
        choices=["end", "page"],
        default="end",
        help="collect footnote definitions at the end or under each page",
    )
    parser.add_argument("--no-figures", action="store_true", help="skip image extraction")
    parser.add_argument("--no-vector-figures", action="store_true", help="skip vector figure rendering")
    parser.add_argument("--no-tables", action="store_true", help="skip table detection")
    parser.add_argument("--no-bold-headings", action="store_true", help="only use font size for headings")
    parser.add_argument("--no-page-join", action="store_true", help="do not join paragraphs across page breaks")
    parser.add_argument("--verify", action="store_true", help="run the OpenRouter verification pass")
    parser.add_argument("--model", default=DEFAULT_VERIFY_MODEL, help="OpenRouter model for verification")
    parser.add_argument("--ocr", choices=["auto", "force", "off"], default="auto", help="OCR behaviour for pages with no text layer")
    parser.add_argument("--ocr-model", default=DEFAULT_OCR_MODEL, help="OpenRouter model for OCR")
    parser.add_argument("--workers", type=int, default=4, help="parallel model requests")
    parser.add_argument("--sidecar", action="store_true", help="also write a per-page JSON audit file")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    cfg = Config(
        dpi=args.dpi,
        page_markers=args.page_markers,
        footnote_placement=args.footnotes,
        extract_figures=not args.no_figures,
        extract_vector_figures=not args.no_vector_figures,
        detect_tables=not args.no_tables,
        bold_headings=not args.no_bold_headings,
        join_pages=not args.no_page_join,
        verify=args.verify,
        verify_model=args.model,
        ocr_mode=args.ocr,
        ocr_model=args.ocr_model,
        workers=max(1, args.workers),
        sidecar=args.sidecar,
        quiet=args.quiet,
        api_key=os.environ.get("OPENROUTER_API_KEY"),
    )

    inputs = gather_inputs(args.input)
    if not inputs:
        sys.exit(f"No PDFs found at {args.input}")
    if args.output and len(inputs) > 1:
        sys.exit("--output only works with a single PDF; use --out-dir for batches")

    for pdf_path in inputs:
        if not os.path.exists(pdf_path):
            print(f"[!] missing: {pdf_path}")
            continue
        if args.output:
            out_path = args.output
        else:
            out_dir = args.out_dir or os.path.dirname(os.path.abspath(pdf_path))
            os.makedirs(out_dir, exist_ok=True)
            stem = os.path.splitext(os.path.basename(pdf_path))[0]
            out_path = os.path.join(out_dir, stem + ".md")
        try:
            convert_pdf(pdf_path, out_path, cfg, args.pages)
        except Cancelled:
            print(f"[!] {os.path.basename(pdf_path)} cancelled")
        except Exception as exc:
            print(f"[!] {os.path.basename(pdf_path)} failed: {exc}")


if __name__ == "__main__":
    main()

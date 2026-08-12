#!/usr/bin/env python3
"""
converter_service.py

A small local service that runs pdf_to_markdown.py for the PostLiterate Admin
Dashboard. It binds to the loopback interface only, so nothing on the network
can reach it.

What one job does:

  1. Saves the uploaded PDF to a scratch directory.
  2. Converts it to Markdown with the verification pass on.
  3. Asks the model to read the title page for bibliographic metadata.
  4. Copies the PDF into the vault under a canonical AuthorYear_Title.pdf name.
  5. Writes a draft source note in the vault's new-source schema.
  6. Appends a row to the reading queue.

Every write is confined to a whitelist of vault directories. A path that
resolves outside them is refused, whatever the client asked for.

Run:
    export OPENROUTER_API_KEY=sk-or-...
    python3 converter_service.py

Environment:
    POSTLITERATE_VAULT    vault root (default /Users/irwinchen/vaults/PostLiterate)
    CONVERTER_PORT        default 8787
    CONVERTER_ORIGINS     comma separated allowed origins for the dashboard
    OPENROUTER_API_KEY    required for the verification pass
"""

from __future__ import annotations

import datetime
import json
import os
import queue
import re
import shutil
import tempfile
import threading
import traceback
import uuid
from typing import Any, Dict, List, Optional

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
import uvicorn

import pdf_to_markdown as p2m


# --------------------------------------------------------------------------
# Paths and safety
# --------------------------------------------------------------------------

VAULT = os.path.realpath(
    os.environ.get("POSTLITERATE_VAULT", "/Users/irwinchen/vaults/PostLiterate")
)
SOURCES = os.path.join(VAULT, "01_Sources")
PDF_DIR = os.path.join(SOURCES, "PDFs")
ARTICLES_DIR = os.path.join(SOURCES, "Articles")
DRAFTS_DIR = os.path.join(ARTICLES_DIR, "_drafts")
CONVERTED_DIR = os.path.join(SOURCES, "Converted")
READING_QUEUE = os.path.join(SOURCES, "READING_QUEUE.md")

# Nothing is written outside these, no matter what the request says.
WRITE_ROOTS = [PDF_DIR, ARTICLES_DIR, CONVERTED_DIR, os.path.dirname(READING_QUEUE)]

PORT = int(os.environ.get("CONVERTER_PORT", "8787"))
ORIGINS = [
    o.strip()
    for o in os.environ.get(
        "CONVERTER_ORIGINS",
        "http://localhost:4321,http://127.0.0.1:4321,http://localhost:3000,http://127.0.0.1:3000",
    ).split(",")
    if o.strip()
]

SCRATCH = os.path.join(tempfile.gettempdir(), "postliterate-converter")
os.makedirs(SCRATCH, exist_ok=True)


def assert_writable(path: str) -> str:
    """Refuse any destination outside the vault whitelist."""
    resolved = os.path.realpath(path)
    for root in WRITE_ROOTS:
        root_real = os.path.realpath(root)
        if resolved == root_real or resolved.startswith(root_real + os.sep):
            return resolved
    raise HTTPException(status_code=400, detail=f"refusing to write outside the vault: {path}")


def safe_stem(name: str) -> str:
    stem = os.path.splitext(os.path.basename(name))[0]
    stem = re.sub(r"[^\w\s\-\.]", "", stem).strip()
    stem = re.sub(r"\s+", "_", stem)
    return stem or "document"


# --------------------------------------------------------------------------
# Job registry
# --------------------------------------------------------------------------

class Job:
    def __init__(self, job_id: str, filename: str, options: Dict[str, Any]) -> None:
        self.id = job_id
        self.filename = filename
        self.options = options
        self.events: "queue.Queue[Dict[str, Any]]" = queue.Queue()
        self.history: List[Dict[str, Any]] = []
        self.state = "queued"
        self.result: Optional[Dict[str, Any]] = None
        self.error: Optional[str] = None
        self.cancelled = threading.Event()
        self.created = datetime.datetime.now().isoformat(timespec="seconds")
        self._seq = 0
        self._lock = threading.Lock()

    def emit(self, payload: Dict[str, Any]) -> None:
        payload = dict(payload)
        payload.setdefault("stage", "progress")
        with self._lock:
            self._seq += 1
            payload["seq"] = self._seq
            self.history.append(payload)
        self.events.put(payload)

    def finish(self, state: str, **fields: Any) -> None:
        self.state = state
        self.emit({"stage": state, **fields})
        self.events.put({"stage": "_close"})


JOBS: Dict[str, Job] = {}
JOBS_LOCK = threading.Lock()


# --------------------------------------------------------------------------
# Vault filing
# --------------------------------------------------------------------------

def canonical_pdf_name(meta: Dict[str, Any], fallback_stem: str) -> str:
    proposed = (meta.get("canonical_filename") or "").strip()
    if proposed and proposed.lower().endswith(".pdf"):
        cleaned = re.sub(r"[^\w\-\.]", "", proposed)
        if len(cleaned) > 8:
            return cleaned
    author = (meta.get("author") or "").strip()
    year = str(meta.get("year") or "").strip()
    surname = "Unknown"
    if author:
        first = author.split(",")[0].strip()
        parts = first.split()
        if parts:
            surname = re.sub(r"[^\w]", "", parts[-1]) or "Unknown"
    title = (meta.get("title") or fallback_stem).strip()
    words = re.sub(r"[^\w\s]", "", title).split()[:4]
    short = "".join(w.capitalize() for w in words) or "Document"
    return f"{surname}{year}_{short}.pdf"


def note_filename(meta: Dict[str, Any], fallback_stem: str) -> str:
    author = (meta.get("author") or "").strip()
    year = str(meta.get("year") or "").strip()
    surname = "Unknown"
    if author:
        first = author.split(",")[0].strip()
        parts = first.split()
        if parts:
            surname = re.sub(r"[^\w]", "", parts[-1]) or "Unknown"
    title = (meta.get("title") or fallback_stem).strip()
    words = re.sub(r"[^\w\s]", "", title).split()[:4]
    short = " ".join(w.capitalize() for w in words) or "Document"
    return f"{surname}{year} {short}.md"


def yaml_quote(value: Any) -> str:
    text = "" if value is None else str(value)
    return text.replace('"', "'").replace("\n", " ").strip()


def build_source_note(
    meta: Dict[str, Any],
    pdf_name: str,
    markdown_rel: str,
    summary: Dict[str, Any],
) -> str:
    today = datetime.date.today().strftime("%m-%d-%Y")
    tags = meta.get("tags") or []
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",") if t.strip()]
    tags_yaml = "\n".join(f"  - {yaml_quote(t)}" for t in tags) if tags else "  - unsorted"

    provenance = "PRIMARY-FULL" if summary.get("rejected", 0) == 0 else "PRIMARY-PARTIAL"
    flags: List[str] = []
    if summary.get("rejected"):
        flags.append(
            f"{summary['rejected']} page(s) failed verification and kept the heuristic "
            f"extraction: {', '.join(summary.get('rejected_pages', [])) or 'see conversion'}"
        )
    if summary.get("ocr"):
        flags.append(
            f"{summary['ocr']} page(s) had no reliable text layer and were "
            f"transcribed from the page image"
        )
    if summary.get("ocr_failed"):
        flags.append(f"{summary['ocr_failed']} page(s) could not be transcribed at all")
    if summary.get("api_errors"):
        flags.append(
            f"{summary['api_errors']} page(s) hit API errors and kept the "
            f"heuristic extraction — check the OpenRouter key/credit and reconvert"
        )
    flag_block = "\n".join(f"- {f}" for f in flags) if flags else "- None"

    return f"""---
type: source
source_type: {yaml_quote(meta.get("source_type") or "paper")}
title: "{yaml_quote(meta.get("title"))}"
author: "{yaml_quote(meta.get("author"))}"
year: {yaml_quote(meta.get("year"))}
publisher: "{yaml_quote(meta.get("publisher"))}"
isbn:
doi: "{yaml_quote(meta.get("doi"))}"
url: "{yaml_quote(meta.get("url"))}"
tags:
{tags_yaml}
status: to-read
rating:
date_added: {today}
pdf: "[[{pdf_name}]]"
markdown: "[[{markdown_rel}]]"
provenance: {provenance}
---

# {yaml_quote(meta.get("title")) or "Untitled"}

## Summary



## Key Quotes

>

## Key Concepts

-

## Connections

- Related to:
- Informs chapters:
- Contradicts/tensions:

## My Thoughts



## Conversion Record

Converted {datetime.date.today().isoformat()} from `{pdf_name}`.
{summary.get('pages_converted', 0)} of {summary.get('pages_total', 0)} pages, \
{summary.get('figures', 0)} figures, {summary.get('footnotes', 0)} footnotes. \
{summary.get('verified', 0)} page(s) passed model verification.

Needs a human eye:

{flag_block}
"""


def append_reading_queue(note_name: str, source_type: str) -> bool:
    if not os.path.exists(READING_QUEUE):
        return False
    assert_writable(READING_QUEUE)
    today = datetime.date.today().strftime("%m-%d-%Y")
    wikilink = os.path.splitext(note_name)[0]
    row = f"| {today} | {wikilink} | {source_type} | [[{wikilink}]] |\n"
    with open(READING_QUEUE, "r", encoding="utf-8") as fh:
        existing = fh.read()
    if wikilink in existing:
        return False
    if not existing.endswith("\n"):
        existing += "\n"
    with open(READING_QUEUE, "w", encoding="utf-8") as fh:
        fh.write(existing + row)
    return True


def unique_path(path: str) -> str:
    if not os.path.exists(path):
        return path
    stem, ext = os.path.splitext(path)
    n = 2
    while os.path.exists(f"{stem}-{n}{ext}"):
        n += 1
    return f"{stem}-{n}{ext}"


# --------------------------------------------------------------------------
# The job itself
# --------------------------------------------------------------------------

def run_job(job: Job, pdf_path: str) -> None:
    try:
        job.state = "running"
        opts = job.options
        cfg = p2m.Config(
            dpi=int(opts.get("dpi", 200)),
            page_markers=opts.get("page_markers", "comment"),
            footnote_placement=opts.get("footnotes", "end"),
            extract_figures=bool(opts.get("figures", True)),
            detect_tables=bool(opts.get("tables", True)),
            verify=True,
            verify_model=opts.get("model") or p2m.DEFAULT_VERIFY_MODEL,
            ocr_model=opts.get("model") or p2m.DEFAULT_OCR_MODEL,
            ocr_mode=opts.get("ocr", "auto"),
            workers=int(opts.get("workers", 4)),
            quiet=True,
            api_key=os.environ.get("OPENROUTER_API_KEY"),
        )

        stem = safe_stem(job.filename)
        os.makedirs(CONVERTED_DIR, exist_ok=True)
        md_path = assert_writable(unique_path(os.path.join(CONVERTED_DIR, stem + ".md")))

        summary = p2m.convert_pdf(
            pdf_path,
            md_path,
            cfg,
            opts.get("pages") or None,
            on_progress=job.emit,
            should_cancel=job.cancelled.is_set,
        )

        job.emit({"stage": "metadata"})
        meta = p2m.extract_bibliography(cfg, pdf_path)
        if not meta.get("title"):
            pdf_meta = summary.get("pdf_metadata") or {}
            meta.setdefault("title", (pdf_meta.get("title") or stem).strip())
            meta.setdefault("author", (pdf_meta.get("author") or "").strip())

        # File the PDF under a canonical name.
        os.makedirs(PDF_DIR, exist_ok=True)
        pdf_name = canonical_pdf_name(meta, stem)
        pdf_dest = assert_writable(unique_path(os.path.join(PDF_DIR, pdf_name)))
        shutil.copy2(pdf_path, pdf_dest)
        pdf_name = os.path.basename(pdf_dest)
        job.emit({"stage": "filed", "pdf": pdf_name})

        # Rename the Markdown to match the note, so the pair is obvious.
        note_name = note_filename(meta, stem)
        desired_md = os.path.join(CONVERTED_DIR, os.path.splitext(note_name)[0] + ".md")
        if os.path.realpath(desired_md) != os.path.realpath(md_path):
            desired_md = assert_writable(unique_path(desired_md))
            try:
                os.replace(md_path, desired_md)
                md_path = desired_md
                summary["markdown_path"] = md_path
            except OSError:
                pass

        # Write the draft source note.
        os.makedirs(DRAFTS_DIR, exist_ok=True)
        markdown_rel = os.path.splitext(os.path.basename(md_path))[0]
        note_body = build_source_note(meta, pdf_name, markdown_rel, summary)
        note_path = assert_writable(unique_path(os.path.join(DRAFTS_DIR, note_name)))
        with open(note_path, "w", encoding="utf-8") as fh:
            fh.write(note_body)

        queued = append_reading_queue(
            os.path.basename(note_path), meta.get("source_type") or "paper"
        )

        job.result = {
            "summary": summary,
            "metadata": meta,
            "pdf_path": pdf_dest,
            "note_path": note_path,
            "markdown_path": md_path,
            "reading_queue_updated": queued,
        }
        job.finish("complete", **{
            "markdown_path": md_path,
            "note_path": note_path,
            "pdf_path": pdf_dest,
            "title": meta.get("title"),
        })

    except p2m.Cancelled:
        job.finish("cancelled")
    except Exception as exc:  # noqa: BLE001
        job.error = f"{type(exc).__name__}: {exc}"
        traceback.print_exc()
        job.finish("failed", error=job.error)
    finally:
        try:
            os.remove(pdf_path)
        except OSError:
            pass


# --------------------------------------------------------------------------
# HTTP surface
# --------------------------------------------------------------------------

app = FastAPI(title="PostLiterate PDF converter", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> Dict[str, Any]:
    return {
        "ok": True,
        "vault": VAULT,
        "vault_present": os.path.isdir(VAULT),
        "converted_dir": CONVERTED_DIR,
        "api_key_present": bool(os.environ.get("OPENROUTER_API_KEY")),
        "default_model": p2m.DEFAULT_VERIFY_MODEL,
        "active_jobs": sum(1 for j in JOBS.values() if j.state == "running"),
    }


@app.post("/convert")
async def convert(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    pages: str = Form(""),
    dpi: int = Form(200),
    page_markers: str = Form("comment"),
    footnotes: str = Form("end"),
    model: str = Form(""),
    workers: int = Form(4),
    figures: bool = Form(True),
    tables: bool = Form(True),
) -> JSONResponse:
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="only .pdf files are accepted")
    if not os.environ.get("OPENROUTER_API_KEY"):
        raise HTTPException(
            status_code=503,
            detail="OPENROUTER_API_KEY is not set, and verification is always on",
        )

    job_id = uuid.uuid4().hex[:12]
    scratch_path = os.path.join(SCRATCH, f"{job_id}.pdf")
    with open(scratch_path, "wb") as fh:
        while chunk := await file.read(1024 * 1024):
            fh.write(chunk)

    options = {
        "pages": pages.strip(),
        "dpi": dpi,
        "page_markers": page_markers,
        "footnotes": footnotes,
        "model": model.strip(),
        "workers": workers,
        "figures": figures,
        "tables": tables,
    }
    job = Job(job_id, file.filename, options)
    with JOBS_LOCK:
        JOBS[job_id] = job

    thread = threading.Thread(target=run_job, args=(job, scratch_path), daemon=True)
    thread.start()

    return JSONResponse({"job_id": job_id, "filename": file.filename})


@app.get("/jobs/{job_id}")
def job_status(job_id: str) -> Dict[str, Any]:
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="no such job")
    return {
        "id": job.id,
        "filename": job.filename,
        "state": job.state,
        "created": job.created,
        "error": job.error,
        "result": job.result,
        "history": job.history[-40:],
    }


@app.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str) -> Dict[str, Any]:
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="no such job")
    job.cancelled.set()
    return {"id": job.id, "cancelling": True}


@app.get("/jobs/{job_id}/events")
def job_events(job_id: str) -> StreamingResponse:
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="no such job")

    def stream():
        # Replay what already happened, so a late listener sees the whole run,
        # then drop anything the replay already covered.
        replayed = 0
        for past in list(job.history):
            replayed = max(replayed, past.get("seq", 0))
            yield f"data: {json.dumps(past)}\n\n"
        if job.state in ("complete", "failed", "cancelled"):
            yield 'data: {"stage": "_close"}\n\n'
            return
        while True:
            try:
                event = job.events.get(timeout=20)
            except queue.Empty:
                yield ": keepalive\n\n"
                continue
            if event.get("stage") == "_close":
                yield f"data: {json.dumps(event)}\n\n"
                return
            if event.get("seq", 0) <= replayed:
                continue
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def main() -> None:
    print(f"vault:   {VAULT}")
    print(f"output:  {CONVERTED_DIR}")
    print(f"origins: {', '.join(ORIGINS)}")
    if not os.environ.get("OPENROUTER_API_KEY"):
        print("warning: OPENROUTER_API_KEY is not set, conversions will be refused")
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="info")


if __name__ == "__main__":
    main()

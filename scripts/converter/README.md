# PostLiterate PDF converter

Turns a PDF into vault-ready Markdown, verified page by page against the page
image by a vision model, then files the PDF and writes a draft source note.

Two pieces. A Python service that runs on the Mac Mini and does the work, and
a section in the Admin Dashboard (`scripts/admin-ui.html`) that gives it a
place to drop a file.

This folder lives in the repo at `scripts/converter/` and reaches the Mini via
the normal appliance flow: push to `origin/main`, the Mini's
`org.postliterate.git-pull` timer delivers it. The `.venv` and `.env` created
by `install.sh` stay local to the Mini and are gitignored.

---

## 1. Install the service (on the Mini)

```bash
cd ~/code/postliterate-site/scripts/converter
./install.sh
```

That creates a virtual environment so PyMuPDF stays out of the way of
`process_unlinked_pdfs.py` and `summarize_sources.py`, which use the system
Python.

Open `.env` and add your OpenRouter key. Verification runs on every page, so
the service refuses to convert anything without it.

Start it:

```bash
./run.sh
```

Check it: `curl localhost:8787/health`

---

## 2. The dashboard section

The section is built into `scripts/admin-ui.html` (nav entry "PDF to
Markdown") and needs no separate install. The browser never talks to the
service directly: `admin.mjs` stream-proxies `/api/converter/*` to
`127.0.0.1:8787/*` — multipart uploads up, SSE progress down. That is what
makes the section work from the MacBook's browser against
`mediaserver.local:4322`, while the Python service stays bound to loopback.

If the service runs on a different port, set `CONVERTER_PORT` in the admin
server's environment (the same value the service reads from its own `.env`).

---

## 3. Start it at login, once you trust it

```bash
cp org.postliterate.converter.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/org.postliterate.converter.plist
```

Logs land in `~/Library/Logs/postliterate-converter.log`.

Use the modern `bootstrap`/`bootout` verbs — the legacy `load`/`unload` pair
fails silently on current macOS. `launchctl list | grep postliterate` is the
clean liveness check.

Note that launchd does not read `.env`. Either add the key to the plist as an
`EnvironmentVariables` dict, or leave `run.sh` sourcing `.env` as it does now,
which is what the plist invokes.

To stop it starting at login:

```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/org.postliterate.converter.plist
```

---

## What one conversion produces

| Where | What |
|---|---|
| `01_Sources/Converted/AuthorYear Short Title.md` | the Markdown, with a `figures/` folder beside it |
| `01_Sources/PDFs/AuthorYear_ShortTitle.pdf` | the PDF under a canonical name |
| `01_Sources/Articles/_drafts/AuthorYear Short Title.md` | draft source note in your schema |
| `01_Sources/READING_QUEUE.md` | one appended row |

Source notes go to `_drafts/` rather than `Articles/`, matching what
`process_unlinked_pdfs.py` already does. Nothing lands in `Articles/` without
you moving it.

The note carries a Conversion Record section listing anything that needs a
human eye: pages that failed verification, pages transcribed by OCR, pages that
could not be read at all. Provenance is set to `PRIMARY-FULL` only when no page
was rejected; otherwise `PRIMARY-PARTIAL`.

---

## Safety

The service binds to `127.0.0.1`, so nothing on the network can reach it
directly; LAN access exists only through the admin server's proxy.

Every write is checked against a whitelist: `01_Sources/PDFs`,
`01_Sources/Articles`, `01_Sources/Converted`, and `01_Sources` itself for the
reading queue. A path resolving anywhere else is refused, whatever the request
asks for. Nothing is ever overwritten — a name collision gets `-2` appended.

---

## Cost

Every page is one vision-model call. The dashboard shows a running total from
OpenRouter's own usage figures, and asks for confirmation before converting
anything that looks longer than fifty pages. Cancel stops new pages; ones
already in flight finish.

If a page comes back mangled, the service keeps the mechanical extraction and
counts the page as rejected. Rejected page numbers are listed in the result
card and in the source note.

---

## Command line

The converter still works on its own, without the service:

```bash
cd ~/code/postliterate-site/scripts/converter
./.venv/bin/python pdf_to_markdown.py paper.pdf -o out.md --verify
./.venv/bin/python pdf_to_markdown.py PDFs/ --out-dir Converted/ --verify --workers 6
./.venv/bin/python pdf_to_markdown.py book.pdf --pages 40-72 --page-markers visible
```

---

## Known weak spot

Full-page figures in dense papers. When a chart holds a lot of text, the vector
figure detector declines to treat it as an image and the chart's labels land in
the prose. The verification pass is what catches this, which is the main reason
it is on by default.

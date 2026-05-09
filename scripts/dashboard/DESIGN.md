# PostLiterate Dashboard — Design Notes

Living design doc for the dashboard work that extends `scripts/admin.mjs`.
Written so a fresh Claude session can resume the work without re-deriving
architecture decisions from scratch.

## Goal

A web dashboard for the *After the Book* project. Twice-daily auto-refresh
(14:00 and 23:00) plus on-demand. Surfaces:

1. Activity summaries — Cowork sessions, Claude.ai chat exports, blog/site git activity, vault edits — all summarized via Haiku.
2. Vault Watch — outstanding sources (PDFs in `01_Sources/PDFs/` without matching `01_Sources/Articles/AuthorYear ShortTitle.md`), reading queue, recent daily notes and inbox items.
3. Cards browser — sidebar parsed from `06_Meta/Book/Cards/INDEX.md`, click to read; "Open in Obsidian" deep link via `obsidian://`.
4. Reminders — parsed from `~/vaults/PostLiterate/TASKS.md`.
5. Writing progress — four word-count series (cards, blog published+drafts, daily notes, inbox + literature notes) with 30-day sparklines and historical snapshots.

## Architecture

**Hosting:** Mac Mini M4 (`mediaserver.local:4322`). Always on, vault is synced there. Reachable from MacBook over LAN today; Tailscale later if/when remote access matters.

**Repo location on Mini:** `~/Documents/postliterate-site` — read-only mirror, fast-forward-only `git pull` every 30 min via launchd timer (`org.postliterate.git-pull`). Edits/publishes continue from MacBook; GitHub is canonical.

**Service:** existing `scripts/admin.mjs` extended with new routes. Runs under launchd as `org.postliterate.dashboard`. Logs at `~/Library/Logs/postliterate-mini/`.

**Vault:** `/Users/irwinchen/vaults/PostLiterate` (synced to both Mac Mini and MacBook via existing sync). Dashboard reads cards, daily notes, sources, `TASKS.md`, and `06_Meta/Sessions/` directly from the synced copy on the Mini.

**Cross-machine session capture:**
- Mini's own Cowork sessions: read natively via `session_info` MCP.
- MacBook Cowork sessions: an hourly Cowork scheduled task on the MacBook lists sessions matching working dirs (vault, postliterate-site, this project), writes per-session digest markdown to `vault/06_Meta/Sessions/YYYY-MM-DD-<sessionid>.md`. Vault sync delivers these to the Mini, which ingests them on each refresh. (Built in Phase 7.)
- iPhone/iPad/web (claude.ai) chats: manual export drop into `~/Documents/postliterate-chat-exports/` on the Mini. Hash-deduped on each refresh.

## Code layout

```
scripts/
  admin.mjs                          # existing — gains /dashboard, /api/dashboard, /api/refresh
  blog-lib.mjs                       # existing — generateProjectStatus already used
  dashboard/
    DESIGN.md                        # this file
    refresh.mjs                      # entry point for scheduled + on-demand refresh
    sources/
      cowork-sessions.mjs            # session_info MCP → Haiku summary
      claude-exports.mjs             # ~/Documents/postliterate-chat-exports/
      vault-sessions.mjs             # ingest synced 06_Meta/Sessions/ digests
      vault-activity.mjs             # daily notes, sources, inbox
      cards.mjs                      # parse INDEX.md, render cards
      writing-progress.mjs           # word counts, snapshots
      vault-watch.mjs                # outstanding sources, reading queue
      todos.mjs                      # TASKS.md parser
    snapshots/
      latest.json                    # current dashboard state, served by /api/dashboard
      YYYY-MM-DD-HHmm.json           # historical snapshots (writing progress trends)
  admin-ui.html                      # existing — gains tabs/sections for dashboard
deploy/mini/                         # done in Step 0
```

Editing happens on the MacBook clone. Push to GitHub. Mini pulls within 30 min (or run `~/Documents/postliterate-site/deploy/mini/git-pull.sh` to force).

## Conventions

- **No new dependencies** unless strictly required. `admin.mjs` is currently Node built-ins only; respect that. `marked` for card markdown is fine if needed (small, zero deps).
- **Read-on-click for cards.** No fs.watch / SSE for now. Keeps things simple; revisit if it feels stale.
- **Read-only on the Mini.** A `READ_ONLY=1` env var gates publish/unpublish/delete buttons. Set in the launchd plist on the Mini. Default off so MacBook dev keeps full functionality.
- **Bind interface.** The Mini service binds all interfaces (Node default). The MacBook service should ideally bind localhost during development to avoid LAN exposure — environment-driven via a `HOST` env var.
- **Snapshots are the dashboard's view.** UI loads `snapshots/latest.json` and renders. Refresh logic regenerates the snapshot. This decouples render from data assembly and keeps the UI cheap to load.
- **Style.** Outfit (UI) / Literata (card prose) / Sono (timestamps/code). Off-white `#F3EFE1`, `#E53E33` accent, `#3B6DB4` and `#549E44` secondary. Bootstrap 12-col grid. No rounded corners, no shadows, no gradients.

## Phases (task list — fill back in if it's empty)

- Step 0 — Mini deployment. **Done.** Mini is hosting at `mediaserver.local:4322`.
- Phase 1 — Scaffolding. **Done (2026-05-08).** `scripts/dashboard/` created; `refresh.mjs` stub; `snapshots/latest.json`; routes `/api/config`, `/dashboard`, `/api/dashboard`, `/api/refresh` added to `admin.mjs`; `READ_ONLY` + `HOST` env vars; Dashboard/Cards/Vault Watch/Writing/Reminders tabs + Refresh button in `admin-ui.html`. READ_ONLY intentionally NOT set on the Mini (Irwin's call — LAN is trusted).
- Phase 2 — Cards browser. **Done (2026-05-08).** `scripts/dashboard/sources/cards.mjs` parses INDEX.md and reads all card files. Snapshot includes `{ total, sections, content }`. UI: sidebar grouped by Part → Chapter, reader pane with marked-rendered body, wikilink styling, Obsidian deep link. 74 cards loaded as of this writing.
- Phase 3 — Vault Watch. **Done (2026-05-08).** `scripts/dashboard/sources/vault-watch.mjs` covers four sub-streams:
  - **Outstanding sources** — diff `01_Sources/PDFs/` against PDFs claimed by article frontmatter (`pdf: "[[Filename.pdf]]"`). 62 outstanding of 116 PDFs as of this writing.
  - **Reading queue** — checkbox parser over `01_Sources/READING_QUEUE.md`. Extracts slug, italic kind, and `added MM-DD-YYYY` per line. 53 unread / 53 total.
  - **Recent daily notes** — newest 7 from `06_Meta/Daily/` (sorted by `MM-DD-YYYY` filename, not mtime).
  - **Recent inbox** — newest 6 `.md` from `00_Inbox/` by mtime.
  UI: KPI row (outstanding/queue/latest daily), then Outstanding + Queue full-width lists, then a 2-col Daily/Inbox grid. Every row links via `obsidian://open?vault=PostLiterate&file=...` so clicks open the right note in Obsidian on whichever machine the dashboard is being viewed from. New `.vw-*` CSS block in `admin-ui.html`. KPI overview unchanged — still counts non-null sections.
- Phase 4 — Writing Progress. **Done (2026-05-08).** `scripts/dashboard/sources/writing-progress.mjs` produces four word/file counters and a 30-day sparkline series:
  - **cards**: `06_Meta/Book/Cards/*.md` — 80 files, 15,132 words at first capture.
  - **blog**: `src/content/blog/*.mdx` (published) + `07_Blog/*.md` (drafts not yet published) — 14 files / 14,878 words.
  - **daily**: `06_Meta/Daily/*.md` — 126 files / 39,589 words.
  - **ideas**: `00_Inbox/*.md` + `01_Sources/Literature Notes/*.md` — 25 files / 9,574 words.
  Word counting strips YAML frontmatter then splits on whitespace. Each refresh writes one daily archive at `scripts/dashboard/snapshots/writing/YYYY-MM-DD.json` (overwritten if today's already exists). Sparkline data is reconstructed by reading up to 30 days of archives. The archive directory is gitignored (`scripts/dashboard/snapshots/writing/`). 7-day and 30-day deltas are computed and surfaced beside each KPI as `+N / 7d`. UI: 4-col KPI row in the existing Writing tab, each card has a Chart.js line sparkline (44px tall, no axes/grid, color-matched to the counter — accent / blue / green / muted). Single-data-point captures render as a dot until the second day's archive arrives.
- Phase 5 — Reminders (TASKS.md parser).
- Phase 6 — Activity summaries (Cowork sessions, Claude.ai exports, vault session digests, blog/git, all summarized via Haiku). Most novel — saved for last.
- Phase 7 — MacBook hourly Cowork digest job (writes to `vault/06_Meta/Sessions/`).
- Phase 8 — Twice-daily refresh schedule on Mini (Cowork scheduled task; should be authored *from a Cowork session running on the Mini*).
- Phase 9 — End-to-end verification on Mini.

## Constraints to remember

- **Don't touch `publish.sh`** — flagged legacy in the project CLAUDE.md.
- **Don't auto-commit.** User reviews before push (per their global CLAUDE.md).
- **Source Transparency Protocol applies** to anything that ends up rendered as content (not infrastructure). Probably not relevant here, but mentioned for completeness.
- **Mini's clone is read-only by default** — `READ_ONLY=1` env var gates publish/unpublish/delete. Currently NOT set on the Mini (intentional — LAN is trusted). The flag and route guards are implemented and ready.
- **Vault path** — `process.env.VAULT_PATH || join(homedir(), 'vaults/PostLiterate')`. Works on both MacBook and Mini. When testing in a non-standard environment, set `VAULT_PATH` explicitly.
- **`marked` CDN** — added to `admin-ui.html` via `cdn.jsdelivr.net/npm/marked@12`. Card bodies are parsed through `marked.parse()` then wikilinks (`[[...]]`) are post-processed into styled `<span class="wikilink">` elements.
- **`snapshots/latest.json`** is committed as a seed file. It gets overwritten on every refresh. Historical snapshots (`YYYY-MM-DD-HHmm.json`) are not yet implemented — Phase 4 adds them.
- **Other work is happening in this repo** (brain-3d component and elsewhere in `src/`). Dashboard work is isolated to `scripts/dashboard/`, `scripts/admin.mjs`, and `scripts/admin-ui.html`. Always `git pull` before starting a phase.

## Open questions deferred to later phases

- Card status field — cards do NOT have a `status:` frontmatter field as of Phase 2. Any cards-by-status panel would need to derive status from content or add the field first.
- Chrome-MCP claude.ai scraper — Phase 6 ingests manually-exported chats. Automating that via Chrome MCP is a possible Phase 10. Not in current scope.
- HTTPS / auth on the Mini — not needed today. Add when we expose beyond the LAN.
- `snapshots/latest.json` in git — currently tracked (seed file). Consider adding `scripts/dashboard/snapshots/*.json` to `.gitignore` once the Mini is reliably refreshing on startup, so generated data doesn't create noise in commits.

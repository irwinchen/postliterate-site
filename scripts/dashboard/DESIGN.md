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

**Repo location on Mini:** `~/Documents/postliterate-site`. As of 2026-05-09 the Mini is also a primary dev host (running Claude Code locally so summaries reflect production data and Ollama is on-machine), so the auto git-pull timer is **off by default**. Sync manually via `deploy/mini/git-pull.sh` when MacBook commits need to land. Re-enable the timer with `INSTALL_GITPULL=1 deploy/mini/install.sh` if you flip back to MacBook-primary dev. GitHub is canonical.

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
- Phase 5 — Reminders. **Done (2026-05-08).** `scripts/dashboard/sources/todos.mjs` parses `06_Meta/TASKS.md` into structured reminders (sections by `##`/`###` headings, checkbox lines `- [ ]` / `- [x]`, one level of nesting via indentation, `📅 YYYY-MM-DD` due dates, `#tag` extraction). Empty placeholder lines are dropped. Each item carries a 1-indexed `line` identifier for write-back. `POST /api/todos/toggle` body `{ line, done }` flips that exact line in place, validating it's still a checkbox before writing — guards against concurrent Obsidian edits. UI: 3-card KPI row (Open / Overdue / Source link to `06_Meta/TASKS.md`), then collapsible sections with checkboxes (event-delegated `change` listener), strikethrough for done, color-coded due-date pills (red overdue, blue today). KPI overview unchanged. Vault has 1 task currently — round-tripped through done/open cleanly.
- Phase 6 — Activity summaries.
  - **Slice 1 — Foundation + git activity.** **Done (2026-05-08).** Summarization runs through a local Ollama daemon (the user is on `gemma3:12b` on the Mini). New `scripts/dashboard/lib/ollama.mjs` is a small `fetch`-based client (no SDK, no new deps) that reads `OLLAMA_HOST` (default `http://localhost:11434`) and `OLLAMA_MODEL` (no default). If the daemon is unreachable or the model isn't set, `generate()` resolves to `null` and source modules fall back to raw rendering. `scripts/dashboard/lib/summary-cache.mjs` is a content-hash cache at `scripts/dashboard/snapshots/summaries/<hash>.json` (gitignored) so repeated refreshes don't re-call the model on unchanged inputs (`SUMMARY_CACHE_DISABLE=1` bypasses). New `scripts/dashboard/sources/git-activity.mjs` reads `git log --since=7.days` across the site repo + vault, groups by date, and asks the model for a 1–3 bullet summary per day. UI is a new "Recent Work" section (sectioned out from the legacy `activity-section`) showing day cards with summary block + per-commit list (color-coded `site` / `vault` repo badges). Mini's launchd plist template (`deploy/mini/launchd/org.postliterate.dashboard.plist.template`) sets `OLLAMA_MODEL=gemma3:12b`. Original Phase-6 plan was Anthropic Haiku; the user picked local Ollama for privacy + zero-cost.
  - **Slice 2 — Cowork sessions, claude.ai exports, vault session digests.** **Done (2026-05-09).** Three new sources added under `scripts/dashboard/sources/`, all reusing `lib/ollama.mjs` + `lib/summary-cache.mjs`. The "Cowork sessions on disk" investigation found that `~/.claude/projects/<hash>/<sessionId>/` only contains `subagents/` data — the actual prompt log lives in `~/.claude/history.jsonl` as `{ display, timestamp, project, sessionId }` lines. The new `cowork-sessions.mjs` reads that file, filters to a hardcoded prefix list (`/Users/irwinchen/Documents/postliterate-site`, `~/vaults/PostLiterate`, `~/Documents/Postliterate` for the Mini's vault), groups by sessionId+day over the last 7 days, and asks the model for a 1–3 bullet **third-person** summary per session (the system prompt explicitly forbids first-person Irwin voice per the project CLAUDE.md). `claude-exports.mjs` reads `~/Documents/postliterate-chat-exports/*.json` (claude.ai conversation exports — empty until you drop a file there); tolerates both single-conversation and array-wrapped formats and both `chat_messages`/`messages` field names. `vault-sessions.mjs` reads `vault/06_Meta/Sessions/*.md` digests directly — no LLM call, since the digest IS the summary; surfaces frontmatter + body preview. Empty until Phase 7 starts writing those.
  - UI: the Recent Work section now renders four streams (git, cowork, claude exports, vault sessions). Git + cowork always render (with empty state when no data). The two file-backed streams suppress entirely when their source dir is empty. Cowork session cards include a `site`/`vault` repo badge, `sessionId.slice(0,8)` for traceability, and a fallback to the truncated first prompt when no summary is available. Streams are visually separated by a thin `border-block-start` rule.
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

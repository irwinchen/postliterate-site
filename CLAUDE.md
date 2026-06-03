# Writing Rules

## Never write as Irwin

Do not write prose, narrative, or any text content in the first person as Irwin Chen. This applies to blog drafts, on-site copy, dashboard content, and any other content files in this repo.

If you are inserting suggested text content (not frontmatter, not filenames, not code), format it as `inline code` so Irwin can always distinguish your insertions from his own writing.

This rule does not apply to:
- Frontmatter fields and values
- Filenames and file paths
- Code, shell commands, and configuration
- Structural scaffolding (headings, wikilinks, HTML structure)

When in doubt, ask rather than write.

## No "It's not X, it's Y"

Never use the "It's not X, it's Y" formulation (and its close variants: "not just X but Y," "X isn't about A — it's about B," and other negation-then-correction antitheses). It is a hollow rhetorical tic that signals AI-generated prose. Make the positive claim directly. This applies to all prose and commentary — blog drafts, on-site copy, dashboard content, summaries, critiques, chat responses, and any suggested text.

---

# postliterate-site
Make sure this is up to date with the most recent git pull. This runs the postliterate.org website as well as the Admin dashboard (which runs on the Mac Mini).

## Project

Astro + Vercel static site for **postliterate.org**, the public-facing companion to the *After the Book* project. Publishes the blog, RSS, Buttondown newsletter, and will eventually host the Librarian concierge/graph feature.

Sibling repos:
- **Vault (book + thinking):** `/Users/irwinchen/vaults/PostLiterate`
- **Virgil (iOS reader):** `/Users/irwinchen/Documents/DeepReader/apps/Virgil`

## Two-Machine Workflow (canonical — other docs point here)

This repo lives on two machines. To prevent the git divergence and stale-lock
problems they used to cause, exactly one machine edits and the other only mirrors.
GitHub `origin/main` is the single source of truth. This section is authoritative;
`deploy/mini/README.md` and `scripts/dashboard/DESIGN.md` defer to it.

- **MacBook = workshop.** All edits, commits, and pushes originate here. `git pull`
  at the start of a session; commit and push when you stop. This is the only machine
  that writes to `origin/main`.
- **Mac Mini (`mediaserver`) = appliance.** It pulls, serves the admin/dashboard on
  `:4322`, and runs the on-machine Ollama summaries. It never edits or commits. An
  `org.postliterate.git-pull` launchd timer fast-forwards it from `origin/main` every
  30 minutes; `deploy/mini/git-pull.sh` forces an immediate sync. If you ever need to
  touch code on the Mini, treat it as an exception: commit and push from there, then
  immediately go back to the MacBook-only rule.

Why this is strict: when both machines committed, their heads diverged and the Mini's
auto-pull silently stalled on a dirty working tree (the dashboard rewrites cache files).
Keeping all writes on one machine removes the whole class of problem. Dashboard refresh
and Ollama summaries run on the Mini regardless — only *editing code* moves to the MacBook.

## Source Transparency Protocol (Always Active)

Blog posts published from this site are public writing samples and will feed chapter prose later. Any substantive claim about a book, paper, or source — whether in a blog draft, on-site copy, or research conversation — must follow the Source Transparency Protocol defined in the vault root `CLAUDE.md`.

**Summary:**

- Every substantive source claim gets an epistemic access tag: `[PRIMARY-FULL]`, `[PRIMARY-PARTIAL]`, `[SECONDARY-ONLY]`, or `[UNCERTAIN]`.
- Web sources get a tier declaration: Tier 1 (publisher/peer-reviewed/primary), Tier 2 (established outlets), Tier 3 (Wikipedia/Medium/SEO — not cited as authority).
- Direct quotes require `[PRIMARY-FULL]` access with the quote locatable, or a Tier 1 reproduction. Otherwise paraphrase and flag for verification.
- Shorter grounded responses always beat longer unverifiable ones. When in doubt, generate less and ask whether to fetch the primary source.

Adherence is silent (no ritual), but the tags must appear inline. Full protocol lives in `/Users/irwinchen/vaults/PostLiterate/CLAUDE.md` under "Source Transparency Protocol." That file is the single source of truth; this is a pointer.

## Publishing Pipeline

- Publish via the admin UI or `npm run blog:publish`. **Do not use `publish.sh`** — it is a legacy shortcut that lacks image handling, history tracking, and source hashing.
- Full pipeline lives in `blog-lib.mjs → publishPost()`.
- When a publish step copies or generates any file beyond the primary content file, all of those files must be explicitly included in the git commit. Trace every file write to confirm it ends up in git.

## Typography Defaults

Match the vault CLAUDE.md defaults:
- Sans-serif / UI: **Outfit**
- Serif / body: **Literata**
- Monospace / code: **Sono**

See vault `CLAUDE.md` "Web Typography" section for the full curated pairing list and principles.

# postliterate-site

## What This Is

Blog publishing site for postliterate.org. Markdown posts written in an Obsidian vault get copied to an Astro + MDX site, deployed on Vercel with auto-deploys on git push. RSS feed powers Buttondown email subscriptions.

## Core Value

Posts go from Obsidian vault to live site with one script and a git push. The pipeline must be frictionless — write, publish, done.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Astro project with MDX support (@astrojs/mdx)
- [ ] Content collection for blog posts with schema (title, date, description, status, tags, social)
- [ ] Blog index page — lists published posts only, sorted by date descending
- [ ] Individual post pages at /blog/[slug]
- [ ] Draft posts render at their URL but are excluded from index and RSS
- [ ] RSS feed at /rss.xml (Buttondown-compatible)
- [ ] Design: Outfit (sans), Literata (serif body), Sono (mono) via Google Fonts
- [ ] Design: Bootstrap grid, #F3EFE1 background, #E53E33 highlight, #3B6DB4/#549E44 secondary
- [ ] Design: Minimal Swiss flat — no rounded corners, no gradients, no drop shadows
- [ ] publish.sh script — copies post from vault, sets status to published, commits, pushes
- [ ] preview.sh script — pushes to draft branch, prints Vercel preview URL
- [ ] Builds cleanly with `npm run dev` and `npm run build`
- [ ] Ready to push to GitHub and connect to Vercel

### Out of Scope

- Buttondown account setup — manual step, not automatable
- Custom domain DNS — manual Vercel/Hover configuration
- Social posting automation — manual per spec
- Email subscription form embed — future enhancement after Buttondown is live
- Comments system — not in spec
- Analytics — not in spec
- Search — not in spec

## Context

- Posts live in Obsidian vault at `~/vaults/PostLiterate/07_Blog/` as `.mdx` files
- Posts are copied (not symlinked) to `src/content/blog/` at publish time — symlinks break on Vercel
- The `social` frontmatter field stores companion Mastodon post text
- Full spec: `~/vaults/PostLiterate/06_Meta/Blog-Publishing-Pipeline.md`

## Constraints

- **Stack**: Astro + MDX + Vercel — per spec, non-negotiable
- **No symlinks**: Vercel build environment doesn't support symlinks to external paths
- **Design**: Must follow exact design spec — fonts, colors, grid, no decorative elements

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| MDX over plain Markdown | Enables YouTube embeds, custom components, rich content in posts | — Pending |
| Copy posts, no symlinks | Symlinks break on Vercel's build environment | — Pending |
| Bootstrap grid | Per design spec — familiar, responsive, no custom CSS grid needed | — Pending |

---
*Last updated: 2026-02-28 after initialization*

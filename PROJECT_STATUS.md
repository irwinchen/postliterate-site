# Post-Literate: Goals, Motivations, and Progress

## What This Is

Post-Literate is a blog about the transition from literacy to whatever comes next. It explores deep reading, orality, AI, and the fate of the written word in a post-literate culture. The site itself is built to embody these ideas — particularly through its Deep Reading mode, which treats reading as a deliberate, focused act rather than passive scrolling.

The blog lives at [postliterate.org](https://postliterate.org).

## Motivation

The publishing pipeline is designed around one principle: **writing should happen in one place, publishing should be frictionless.**

Posts are written in Obsidian, where the author already thinks and works. When a post is ready, a single action copies it to the site, commits, pushes, and it's live in 30 seconds. No CMS login, no web editor, no deploy button. The vault is the source of truth; the site is a projection of it.

The reading experience matters as much as the writing. Deep Reading mode strips away everything except the text — no navigation, no sidebar, no scroll position anxiety. Content reveals one section at a time, like turning pages. The fullscreen option removes even the browser chrome. This is a site that takes its own subject seriously.

## Architecture

- **Authoring**: Obsidian vault (`~/vaults/PostLiterate/07_Blog/`)
- **Build**: Astro 5 + MDX, static generation
- **Hosting**: Vercel, auto-deploys on push to main
- **Admin**: Custom Node.js tooling (CLI + web dashboard)
- **Design**: Hand-written CSS, zero frameworks

The deliberate absence of frameworks is a design choice. No React, no Tailwind, no CMS. The site is vanilla HTML/CSS/JS rendered by Astro. The admin tools are Node.js built-ins only. This keeps the system small, fast, and fully understandable.

## Features Built

### Site

| Feature | Status | Description |
|---------|--------|-------------|
| Blog index | Done | Published posts sorted by date, tag filtering |
| Post pages | Done | Full MDX rendering with article header, metadata, tags |
| Tag pages | Done | Per-tag archive at `/blog/tag/[tag]` |
| RSS feed | Done | Atom feed at `/rss.xml` for Buttondown subscriptions |
| About page | Done | Blog and author introduction |
| Colophon | Done | Technical credits |
| Dark mode | Done | Toggle in settings, persisted in localStorage |
| Margin notes | Done | Tufte-style side notes on desktop, tap-to-expand on mobile |

### Deep Reading Mode

| Feature | Status | Description |
|---------|--------|-------------|
| Focus reader | Done | Hide-and-reveal content, one section at a time |
| Progress ring | Done | SVG progress indicator on advance button |
| Keyboard shortcuts | Done | Space, ArrowDown, J to advance |
| Fullscreen toggle | Done | Bottom-right button, icon swaps on state change |
| Auto-exit fullscreen | Done | Exiting Deep Reading exits fullscreen too |
| Nav/footer hiding | Done | Chrome fades out, reappears on hover |
| Margin note suppression | Done | Notes hidden in Deep Reading to reduce distraction |

### Publishing Pipeline

| Feature | Status | Description |
|---------|--------|-------------|
| publish.sh | Done | One-line publish from vault to production |
| preview.sh | Done | Push to draft branch for Vercel preview URL |
| CLI (blog.mjs) | Done | list, preview, publish, unpublish, clean commands |
| Live preview | Done | Sync drafts, watch for changes, auto-reload |
| Margin note transform | Done | Convert Obsidian footnote syntax to MarginNote components |

### Admin Dashboard

| Feature | Status | Description |
|---------|--------|-------------|
| Post listing | Done | All posts with status, location, date |
| Publish/unpublish | Done | One-click with confirmation modal |
| Republish detection | Done | Compares vault vs content file timestamps |
| Republish button | Done | Appears when vault file is newer than published version |
| Delete (published) | Done | Remove from production, vault copy untouched |
| Delete (draft) | Done | Remove from vault permanently |
| Preview | Done | Sync draft and open in dev server |
| Dev server control | Done | Start/stop from dashboard, status indicator |
| Clean synced drafts | Done | Remove temporary preview files |

## Design System

Swiss-inspired minimal design. No rounded corners, no gradients, no drop shadows.

- **Typography**: Outfit (sans/headings), Literata (serif/body), Sono (mono)
- **Colors**: Warm paper background (#F3EFE1), red accent (#E53E33), blue (#3B6DB4), green (#549E44)
- **Dark mode**: `light-dark()` CSS function — one attribute flip, all colors adapt
- **Layout**: CSS Grid, 65ch content width, Van de Graaf-inspired proportions
- **CSS**: Modern techniques throughout — logical properties, nesting, `text-wrap: balance/pretty`, `100dvh`, `:focus-visible`

## What's Not Built (and may never be)

- Comments system
- Analytics
- Search
- Email subscription form (Buttondown integration is RSS-based)
- Social posting automation
- Multi-author support

These omissions are intentional. The site is a focused reading environment, not a platform.

## Development Notes

- Admin runs on port 4322, dev server on 4321
- Content collection `post.id` includes `.mdx` extension — strip for URLs
- Synced drafts use `{/* synced-draft */}` marker, auto-cleaned on admin exit
- All publish/unpublish operations auto-commit and push to main
- GSD planning files in `.planning/` (PROJECT.md, ROADMAP.md, STATE.md)

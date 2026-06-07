# Astro Starter Kit: Minimal

```sh
npm create astro@latest -- --template minimal
```

> 🧑‍🚀 **Seasoned astronaut?** Delete this file. Have fun!

## 🚀 Project Structure

Inside of your Astro project, you'll see the following folders and files:

```text
/
├── public/
├── src/
│   └── pages/
│       └── index.astro
└── package.json
```

Astro looks for `.astro` or `.md` files in the `src/pages/` directory. Each page is exposed as a route based on its file name.

There's nothing special about `src/components/`, but that's where we like to put any Astro/React/Vue/Svelte/Preact components.

Any static assets, like images, can be placed in the `public/` directory.

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`      |
| `npm run build`           | Build your production site to `./dist/`          |
| `npm run preview`         | Preview your build locally, before deploying     |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `npm run astro -- --help` | Get help using the Astro CLI                     |

## 📡 Syndication (POSSE)

Posts publish here first — this is the canonical copy. `scripts/syndicate.mjs`
then pushes an **excerpt with a link back** to Mastodon and Bluesky.

This is a **separate step that runs AFTER deploy**, never part of the build.
The syndicated post links to the canonical URL, so that URL has to be live
first. Order: `npm run build` → deploy (push to `main` → Vercel) →
`npm run syndicate`.

### Opt a post in

Add a `syndicate` array to the post's frontmatter (omit it to syndicate
nowhere):

```yaml
syndicate:
  - mastodon
  - bluesky
excerpt: "Optional syndication blurb. Falls back to description, then the first paragraph."
```

Only `status: published` posts are considered. Each slug+target pair is
recorded in `.syndication/log.json` (committed) so it never double-posts;
re-running is safe and only sends what's new. A failure on one platform is
logged and does **not** block the other, and isn't recorded — so a re-run
retries just that one.

### Setup

```sh
cp .env.example .env   # then fill in the secrets below
```

- **`SITE_URL`** — canonical origin, e.g. `https://postliterate.org` (no
  trailing slash). Must match the deployed site.
- **Mastodon access token** — on your instance go to **Preferences →
  Development → New application**, give it `write:statuses` scope, save, then
  copy **Your access token** into `MASTODON_ACCESS_TOKEN`. Set
  `MASTODON_INSTANCE` to the instance origin (e.g. `https://saturation.social`).
- **Bluesky app password** — **Settings → Privacy and Security → App
  Passwords → Add App Password**. Use that (never your main password) for
  `BLUESKY_APP_PASSWORD`, and your handle or email for `BLUESKY_IDENTIFIER`.

`.env` is gitignored; `.env.example` is the committed template.

### Run

```sh
npm run syndicate                      # all eligible posts, all targets
npm run syndicate -- --dry-run         # print what would post; no network, no writes
npm run syndicate -- --slug=my-path-to-ai
npm run syndicate -- --only=mastodon   # limit targets (comma-separated)
```

Output is per post, per platform: posted / skipped / failed (with the
reason). The command exits non-zero if anything failed.

## 👀 Want to learn more?

Feel free to check [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).

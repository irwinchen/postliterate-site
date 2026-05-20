# Mac Mini Deployment

Deploys the postliterate-site admin/dashboard service to the Mac Mini as an
always-on launchd-managed process. The Mini runs a **read-only mirror** of
the site repo: a launchd timer pulls `origin/main` every 30 minutes, but no
editing or publishing originates here. All development happens on the
MacBook; GitHub is the source of truth.

> **Repo must not live under `~/Documents`.** That folder is iCloud-synced
> and TCC-protected: launchd-spawned scripts can't read it, and uncommitted
> edits from another Mac leak in via iCloud and break `git pull`. Clone to
> `~/code/postliterate-site` (or any non-iCloud, non-protected path) instead.
> `install.sh` refuses to run from `~/Documents` for this reason.

## What this installs

Two launchd user agents, both scoped to your user (no admin/sudo required):

- `org.postliterate.dashboard` — runs `node scripts/admin.mjs` on `:4322`,
  bound to all interfaces so the MacBook can reach it over LAN/Tailscale.
  Restarts automatically if it crashes.
- `org.postliterate.git-pull` — every 30 minutes, runs
  `git pull --ff-only origin main` to keep the mirror current. Fast-forward
  only; aborts if the working tree drifts. Opt out via
  `INSTALL_GITPULL=0 ./deploy/mini/install.sh` only if the Mini is
  temporarily doing dev work.

Logs go to `~/Library/Logs/postliterate-mini/`.

## One-time setup on the Mini

Run these on the Mini directly (Screen Sharing is fine; SSH from the MacBook
over Tailscale also fine).

### 1. Authenticate `gh` (skips if already done)

```sh
gh auth status || gh auth login
```

Use HTTPS, follow the device-code flow, grant `repo` scope.

### 2. Clone the repo

```sh
mkdir -p ~/code
gh repo clone irwinchen/postliterate-site ~/code/postliterate-site
cd ~/code/postliterate-site
```

If you already have it cloned somewhere else, `cd` into it — **as long as it's
not under `~/Documents`** (see warning above). If it is, move it first.

### 3. Install dependencies

```sh
npm install
```

### 4. Run the installer

```sh
./deploy/mini/install.sh
```

The installer:
- Detects your Node binary (handles nvm, Homebrew, system installs).
- Substitutes your home directory and Node path into the plist templates.
- Copies plists to `~/Library/LaunchAgents/`.
- Loads both agents via `launchctl bootstrap`.
- Prints the dashboard URL when it's done.

You should see something like:

```
✓ Dashboard service running.
✓ Git-pull timer running (every 30 min).

Reach the dashboard from your MacBook:
  http://yourminihostname.local:4322/

Logs:
  ~/Library/Logs/postliterate-mini/dashboard.out.log
  ~/Library/Logs/postliterate-mini/dashboard.err.log
  ~/Library/Logs/postliterate-mini/git-pull.log
```

### 5. Verify from the MacBook

Open the printed URL in a browser. You should see the existing admin UI.
That confirms the Mini is hosting and the network path works. The new
dashboard sections will land in Phase 1+.

## Useful commands on the Mini

Check service status:

```sh
launchctl print gui/$UID/org.postliterate.dashboard | head -20
launchctl print gui/$UID/org.postliterate.git-pull | head -20
```

Stop / restart the dashboard service:

```sh
launchctl bootout  gui/$UID/org.postliterate.dashboard
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/org.postliterate.dashboard.plist
```

Tail logs:

```sh
tail -f ~/Library/Logs/postliterate-mini/dashboard.{out,err}.log
tail -f ~/Library/Logs/postliterate-mini/git-pull.log
```

Force an immediate `git pull`:

```sh
~/code/postliterate-site/deploy/mini/git-pull.sh
```

The dashboard's **Refresh** button also runs `git pull --ff-only` in-process
before generating the snapshot — useful for on-demand sync, but the
30-minute timer handles routine updates.

## Updating

The timer pulls every 30 min. To force an update and restart the dashboard:

```sh
cd ~/code/postliterate-site
./deploy/mini/git-pull.sh
launchctl kickstart -k gui/$UID/org.postliterate.dashboard
```

## Uninstall

Run `./deploy/mini/uninstall.sh` (added in a later step) or manually:

```sh
launchctl bootout gui/$UID/org.postliterate.dashboard
launchctl bootout gui/$UID/org.postliterate.git-pull
rm ~/Library/LaunchAgents/org.postliterate.{dashboard,git-pull}.plist
```

## Notes

- The Mini's clone is read-only by convention. All development happens on
  the MacBook. The auto git-pull timer keeps the Mini current; the Refresh
  button additionally runs an in-process `git pull --ff-only` for on-demand
  sync between timer ticks.
- `READ_ONLY=1` is supported by `admin.mjs` and disables publish / unpublish /
  delete routes. Set it via the dashboard plist's `EnvironmentVariables`
  to make the Mini's dashboard view-only.
- If you use nvm, the installer reads `~/.nvm/alias/default` to pin the
  Node version into the plist. Updating Node later means rerunning the
  installer so the plist points at the new binary.
- mDNS (`*.local`) works on any LAN. If you later want remote access,
  install Tailscale on both machines and replace the `.local` hostname
  with the tailnet hostname in the URL — no service-side change needed.

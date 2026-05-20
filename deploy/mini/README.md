# Mac Mini Deployment

Deploys the postliterate-site admin/dashboard service to the Mac Mini as an
always-on launchd-managed process. The Mini is now a **primary dev host** —
Claude Code runs locally on it and edits happen here as well as on the
MacBook. GitHub is the source of truth; pulls are manual by default so they
can't fight uncommitted local work.

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
- `org.postliterate.git-pull` — **opt-in.** Plist renders to disk but is
  not loaded by default. When loaded, runs `git pull --ff-only origin main`
  every 30 minutes. Fast-forward only; aborts if the tree drifts. Re-enable
  with `INSTALL_GITPULL=1 ./deploy/mini/install.sh` only when the Mini is
  truly read-only again.

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
  Skipping auto git-pull timer (default — Mini is dev host).

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
before generating the snapshot, so for interactive sync you usually don't
need to shell out — click Refresh and the status line will report what was
pulled.

## Updating

Pulls are manual by default. To bring in new code and restart the dashboard:

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

- The Mini is now a primary dev host (Claude Code runs here). Auto git-pull
  is therefore opt-in — it would fight uncommitted local edits. The Refresh
  button handles interactive sync; flip on the timer with `INSTALL_GITPULL=1`
  only if the Mini reverts to a read-only role.
- `READ_ONLY=1` is supported by `admin.mjs` and disables publish / unpublish /
  delete routes. Set it via the dashboard plist's `EnvironmentVariables`
  when you want the Mini's dashboard to be view-only.
- If you use nvm, the installer reads `~/.nvm/alias/default` to pin the
  Node version into the plist. Updating Node later means rerunning the
  installer so the plist points at the new binary.
- mDNS (`*.local`) works on any LAN. If you later want remote access,
  install Tailscale on both machines and replace the `.local` hostname
  with the tailnet hostname in the URL — no service-side change needed.

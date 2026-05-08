# Mac Mini Deployment

Deploys the postliterate-site admin/dashboard service to the Mac Mini as an
always-on launchd-managed process. The Mini runs a **read-only mirror** of
the site repo: `git pull` keeps it current, but no edits or publishes
originate here. Editing/publishing continues to happen from the MacBook;
GitHub is the source of truth.

## What this installs

Two launchd user agents, both scoped to your user (no admin/sudo required):

- `org.postliterate.dashboard` — runs `node scripts/admin.mjs` on `:4322`,
  bound to all interfaces so the MacBook can reach it over LAN/Tailscale.
  Restarts automatically if it crashes.
- `org.postliterate.git-pull` — every 30 minutes, runs
  `git pull --ff-only origin main` in `~/Documents/postliterate-site`. Fast-forward
  only — if the working tree drifts the pull aborts rather than mangling things.

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
mkdir -p ~/Documents
gh repo clone irwinchen/postliterate-site ~/Documents/postliterate-site
cd ~/Documents/postliterate-site
```

If you already have it cloned, `cd` into it and `git pull` instead.

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
~/Documents/postliterate-site/deploy/mini/git-pull.sh
```

## Updating

When new code lands on `main`, the timer pulls it within 30 min. To force
an update and restart the dashboard:

```sh
cd ~/Documents/postliterate-site
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

- The Mini's clone is read-only by convention. The dashboard's
  publish/unpublish/delete buttons should not be used from the Mini
  (a `READ_ONLY` flag will be added in Phase 1 to disable them outright).
- If you use nvm, the installer reads `~/.nvm/alias/default` to pin the
  Node version into the plist. Updating Node later means rerunning the
  installer so the plist points at the new binary.
- mDNS (`*.local`) works on any LAN. If you later want remote access,
  install Tailscale on both machines and replace the `.local` hostname
  with the tailnet hostname in the URL — no service-side change needed.

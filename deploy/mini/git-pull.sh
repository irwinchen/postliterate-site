#!/usr/bin/env bash
# Pulls the latest main into the Mini's read-only mirror of postliterate-site.
# Invoked by the org.postliterate.git-pull launchd timer every 30 minutes,
# and can be run manually any time.
#
# Strategy:
#   - Always fast-forward only. If the working tree has diverged, we abort
#     and log loudly rather than mangle anything. The Mini's clone is
#     read-only by convention; divergence means someone edited locally.
#   - On success, restart the dashboard service so it picks up new code.
#   - Idempotent: safe to run repeatedly. No-ops if already up to date.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$HOME/Library/Logs/postliterate-mini"
LOG_FILE="$LOG_DIR/git-pull.log"
DASHBOARD_LABEL="org.postliterate.dashboard"

mkdir -p "$LOG_DIR"

ts() { date "+%Y-%m-%d %H:%M:%S"; }
log() { printf '[%s] %s\n' "$(ts)" "$*" >> "$LOG_FILE"; }

cd "$REPO_ROOT"

# Find git — launchd's PATH is minimal, so prefer absolute.
GIT="$(command -v git || true)"
if [[ -z "$GIT" ]]; then
  for p in /opt/homebrew/bin/git /usr/local/bin/git /usr/bin/git; do
    [[ -x "$p" ]] && GIT="$p" && break
  done
fi
if [[ -z "$GIT" ]]; then
  log "ERROR: git not found in PATH or common locations"
  exit 1
fi

# Detect divergence before pulling.
LOCAL_REV="$("$GIT" rev-parse HEAD 2>/dev/null || echo unknown)"
"$GIT" fetch --quiet origin main || {
  log "ERROR: git fetch failed (network? auth?)"
  exit 1
}
REMOTE_REV="$("$GIT" rev-parse origin/main)"

if [[ "$LOCAL_REV" == "$REMOTE_REV" ]]; then
  log "up-to-date at $LOCAL_REV"
  exit 0
fi

# Fast-forward only.
if ! "$GIT" merge-base --is-ancestor "$LOCAL_REV" "$REMOTE_REV"; then
  log "ERROR: working tree has diverged from origin/main."
  log "       Local:  $LOCAL_REV"
  log "       Remote: $REMOTE_REV"
  log "       Refusing to pull. Investigate manually."
  exit 2
fi

if "$GIT" pull --ff-only --quiet origin main; then
  NEW_REV="$("$GIT" rev-parse HEAD)"
  log "pulled $LOCAL_REV → $NEW_REV"

  # Reinstall dependencies if package.json or lockfile changed.
  if "$GIT" diff --name-only "$LOCAL_REV" "$NEW_REV" | grep -qE '^(package(-lock)?\.json)$'; then
    log "package.json changed; running npm install"
    NPM="$(dirname "$(command -v node 2>/dev/null || echo /usr/bin/node)")/npm"
    [[ ! -x "$NPM" ]] && NPM="$(command -v npm || true)"
    if [[ -n "$NPM" ]]; then
      "$NPM" install --silent >>"$LOG_FILE" 2>&1 || log "WARN: npm install failed"
    else
      log "WARN: npm not found; skipping install"
    fi
  fi

  # Kick the dashboard so it picks up new code.
  if launchctl print "gui/$UID/$DASHBOARD_LABEL" >/dev/null 2>&1; then
    launchctl kickstart -k "gui/$UID/$DASHBOARD_LABEL" 2>/dev/null \
      && log "kicked $DASHBOARD_LABEL" \
      || log "WARN: failed to kick $DASHBOARD_LABEL"
  fi
else
  log "ERROR: git pull failed"
  exit 1
fi

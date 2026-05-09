#!/usr/bin/env bash
# Installs the postliterate dashboard launchd agents on the Mac Mini.
# Idempotent: re-running replaces the existing agents cleanly.
set -euo pipefail

# ── Paths ────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
LOG_DIR="$HOME/Library/Logs/postliterate-mini"
TEMPLATE_DIR="$SCRIPT_DIR/launchd"

DASHBOARD_LABEL="org.postliterate.dashboard"
GITPULL_LABEL="org.postliterate.git-pull"

DASHBOARD_PLIST="$LAUNCH_AGENTS_DIR/${DASHBOARD_LABEL}.plist"
GITPULL_PLIST="$LAUNCH_AGENTS_DIR/${GITPULL_LABEL}.plist"

# ── Pretty output ────────────────────────────────────────────────────
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
red()    { printf '\033[31m%s\033[0m\n' "$*" >&2; }

# ── Sanity checks ────────────────────────────────────────────────────
if [[ "$REPO_ROOT" != "$HOME/Documents/postliterate-site" ]]; then
  yellow "Note: repo is at $REPO_ROOT, not the conventional ~/Documents/postliterate-site."
  yellow "The launchd plists will reference this exact path. If you move the repo later, rerun this installer."
fi

if [[ ! -f "$REPO_ROOT/scripts/admin.mjs" ]]; then
  red "✗ Cannot find scripts/admin.mjs. Are you in the postliterate-site repo?"
  exit 1
fi

# ── Detect Node ──────────────────────────────────────────────────────
# launchd has a minimal PATH. We need an absolute path to the node binary.
detect_node() {
  # Try nvm first (most flexible)
  if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
    # shellcheck disable=SC1091
    \. "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true
    if command -v node >/dev/null 2>&1; then
      command -v node
      return 0
    fi
  fi
  # Homebrew (Apple Silicon and Intel)
  for p in /opt/homebrew/bin/node /usr/local/bin/node; do
    [[ -x "$p" ]] && { echo "$p"; return 0; }
  done
  # System / PATH
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi
  return 1
}

if ! NODE_BIN="$(detect_node)"; then
  red "✗ Could not locate a node binary. Install Node 20+ via nvm or Homebrew, then rerun."
  exit 1
fi

NODE_VERSION="$("$NODE_BIN" --version 2>/dev/null || echo unknown)"
NODE_DIR="$(dirname "$NODE_BIN")"
green "✓ Node detected: $NODE_BIN ($NODE_VERSION)"

# ── Ensure dependencies are installed ────────────────────────────────
if [[ ! -d "$REPO_ROOT/node_modules" ]]; then
  yellow "node_modules missing — running npm install."
  (cd "$REPO_ROOT" && "$NODE_DIR/npm" install)
fi

# ── Prepare logging ──────────────────────────────────────────────────
mkdir -p "$LOG_DIR"
mkdir -p "$LAUNCH_AGENTS_DIR"

# ── Render plist templates ───────────────────────────────────────────
render_template() {
  local template="$1"
  local target="$2"
  sed \
    -e "s|@HOME@|$HOME|g" \
    -e "s|@USER@|$USER|g" \
    -e "s|@REPO_ROOT@|$REPO_ROOT|g" \
    -e "s|@NODE_BIN@|$NODE_BIN|g" \
    -e "s|@NODE_DIR@|$NODE_DIR|g" \
    -e "s|@LOG_DIR@|$LOG_DIR|g" \
    "$template" > "$target"
}

green "✓ Rendering launchd plists into $LAUNCH_AGENTS_DIR"
render_template "$TEMPLATE_DIR/${DASHBOARD_LABEL}.plist.template" "$DASHBOARD_PLIST"
render_template "$TEMPLATE_DIR/${GITPULL_LABEL}.plist.template"   "$GITPULL_PLIST"

# Validate plists before loading
plutil -lint "$DASHBOARD_PLIST" >/dev/null
plutil -lint "$GITPULL_PLIST"   >/dev/null

# ── (Re)load agents ──────────────────────────────────────────────────
reload_agent() {
  local label="$1"
  local plist="$2"
  if launchctl print "gui/$UID/$label" >/dev/null 2>&1; then
    launchctl bootout "gui/$UID/$label" 2>/dev/null || true
    sleep 1
  fi
  launchctl bootstrap "gui/$UID" "$plist"
  launchctl enable "gui/$UID/$label" 2>/dev/null || true
}

green "✓ Loading $DASHBOARD_LABEL"
reload_agent "$DASHBOARD_LABEL" "$DASHBOARD_PLIST"

# Auto git-pull is opt-in. By default we don't install the timer
# because the Mini is now a primary dev host (running Claude Code
# locally) — auto-pull would fight uncommitted changes. Re-enable
# explicitly by running the install with INSTALL_GITPULL=1 set, or
# use deploy/mini/git-pull.sh manually whenever you want to sync.
if [[ "${INSTALL_GITPULL:-0}" == "1" ]]; then
  green "✓ Loading $GITPULL_LABEL (INSTALL_GITPULL=1 set)"
  reload_agent "$GITPULL_LABEL" "$GITPULL_PLIST"
else
  yellow "  Skipping auto git-pull timer (default — Mini is dev host)."
  yellow "  Pull manually via: ~/Documents/postliterate-site/deploy/mini/git-pull.sh"
  yellow "  Re-enable timer with: INSTALL_GITPULL=1 $0"
fi

# ── Verify dashboard is up ───────────────────────────────────────────
sleep 2
if curl -sSf -o /dev/null --max-time 3 "http://localhost:4322/api/posts"; then
  green "✓ Dashboard responding on localhost:4322"
else
  yellow "⚠ Dashboard not responding yet on localhost:4322. Check logs:"
  yellow "    tail -f $LOG_DIR/dashboard.err.log"
fi

# ── Print reachability info ──────────────────────────────────────────
HOSTNAME_LOCAL="$(scutil --get LocalHostName 2>/dev/null || hostname -s)"
echo
green "──────────────────────────────────────────────────────"
green "  Reach the dashboard from your MacBook:"
green "    http://${HOSTNAME_LOCAL}.local:4322/"
green ""
green "  Logs:"
green "    $LOG_DIR/dashboard.out.log"
green "    $LOG_DIR/dashboard.err.log"
green "    $LOG_DIR/git-pull.log"
green "──────────────────────────────────────────────────────"

#!/usr/bin/env bash
# Sets up the PostLiterate PDF converter service on the Mac Mini.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

echo "Creating the virtual environment..."
python3 -m venv .venv
./.venv/bin/pip install --upgrade pip --quiet
./.venv/bin/pip install -r requirements.txt

if [ ! -f .env ]; then
  cat > .env <<'ENVEOF'
# Your OpenRouter key. Verification runs on every page, so this is required.
OPENROUTER_API_KEY=

# Vault root.
POSTLITERATE_VAULT=/Users/irwinchen/vaults/PostLiterate

# Port the dashboard talks to.
CONVERTER_PORT=8787

# Origins allowed to call the service directly, without the admin proxy.
# Dashboard traffic arrives via admin.mjs (/api/converter/*), which is
# server-to-server and not subject to CORS; these only matter for a browser
# on this machine talking straight to :8787.
CONVERTER_ORIGINS=http://localhost:4321,http://127.0.0.1:4321,http://localhost:4322,http://127.0.0.1:4322
ENVEOF
  echo
  echo "Wrote .env — put your OpenRouter key in it before starting."
fi

echo
echo "Done. Start the service with:  ./run.sh"

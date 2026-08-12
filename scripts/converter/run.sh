#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"
set -a; [ -f .env ] && source .env; set +a
exec ./.venv/bin/python converter_service.py

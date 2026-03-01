#!/bin/bash
# Copies a post from the vault to the Astro repo, sets status to published, commits, and pushes.
# Accepts .md or .mdx files. .md files are copied as .mdx automatically.
# Usage: ./publish.sh ~/vaults/PostLiterate/07_Blog/my-post.md

set -e

FILE=$1

if [ -z "$FILE" ]; then
  echo "Usage: ./publish.sh <path-to-file>"
  exit 1
fi

if [ ! -f "$FILE" ]; then
  echo "Error: File not found: $FILE"
  exit 1
fi

BASENAME=$(basename "$FILE")
EXT="${BASENAME##*.}"
SLUG="${BASENAME%.*}"
DEST="./src/content/blog/$SLUG.mdx"

cp "$FILE" "$DEST"
sed -i '' 's/status: draft/status: published/' "$DEST"

git add . && git commit -m "publish: $SLUG" && git push origin main

echo "Published. Live in ~30s at postliterate.org/blog/$SLUG"

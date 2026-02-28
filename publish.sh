#!/bin/bash
# Copies a post from the vault to the Astro repo, sets status to published, commits, and pushes.
# Usage: ./publish.sh /path/to/vault/07_Blog/my-post.mdx

set -e

FILE=$1

if [ -z "$FILE" ]; then
  echo "Usage: ./publish.sh <path-to-mdx-file>"
  exit 1
fi

if [ ! -f "$FILE" ]; then
  echo "Error: File not found: $FILE"
  exit 1
fi

SLUG=$(basename "$FILE" .mdx)
DEST="./src/content/blog/$SLUG.mdx"

cp "$FILE" "$DEST"
sed -i '' 's/status: draft/status: published/' "$DEST"

git add . && git commit -m "publish: $SLUG" && git push origin main

echo "Published. Live in ~30s at postliterate.org/blog/$SLUG"

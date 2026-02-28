#!/bin/bash
# Pushes current state to a draft branch and prints the Vercel preview URL.
# Usage: ./preview.sh my-post-slug

set -e

SLUG=$1

if [ -z "$SLUG" ]; then
  echo "Usage: ./preview.sh <post-slug>"
  exit 1
fi

git add . && git commit -m "preview: $SLUG" && git push origin "draft/$SLUG"

echo "Preview: https://postliterate-git-draft-$SLUG.vercel.app/blog/$SLUG"

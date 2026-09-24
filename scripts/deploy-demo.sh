#!/bin/sh
# Builds the static demo and publishes it to the gh-pages branch (GitHub Pages).
set -e
REMOTE="${DEMO_REMOTE:-git@github-prototype-tool:markelmallakh/prototype-tool.git}"

npm run build:demo
cd dist-demo
rm -rf .git
git init -q -b gh-pages
git add -A
git commit -q -m "Deploy demo" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -f "$REMOTE" gh-pages
rm -rf .git
echo "Published: https://markelmallakh.github.io/prototype-tool/"

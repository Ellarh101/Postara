#!/data/data/com.termux/files/usr/bin/bash
# Run this from the NEW app folder after unzipping a new version.
# It brings over your settings, posts and WhatsApp login from the old folder, then installs.
set -e
cd "$(dirname "$0")"
OLD="${1:-$HOME/whatsapp-poster}"
HERE="$(pwd)"

if [ "$OLD" != "$HERE" ] && [ -d "$OLD" ]; then
  [ -f "$OLD/.env" ] && cp "$OLD/.env" .env
  [ -d "$OLD/data" ] && rm -rf data && cp -r "$OLD/data" data
  # keep the GitHub link and history, if you have set that up (bash git-setup.sh)
  [ -d "$OLD/.git" ] && [ ! -d .git ] && cp -r "$OLD/.git" .git
  echo "Copied your settings and WhatsApp login from $OLD"
fi

[ -f .env ] || cp .env.example .env
npm install --omit=optional --legacy-peer-deps
chmod +x start.sh
echo
echo "Updated. Start it with:  bash start.sh"

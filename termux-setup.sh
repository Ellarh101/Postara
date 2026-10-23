#!/data/data/com.termux/files/usr/bin/bash
# One-time setup for an Android phone, using the Termux app.
set -e
cd "$(dirname "$0")"

echo "== 1/3 Installing what the app needs (a few minutes) =="
pkg update -y
pkg install -y nodejs-lts git nano unzip

echo "== 2/3 Installing the app (a few minutes) =="
npm install --omit=optional --legacy-peer-deps

echo "== 3/3 Getting ready =="
[ -f .env ] || cp .env.example .env
chmod +x start.sh

echo
echo "All set."
echo "Next: add your Claude key (optional but recommended):"
echo "  echo 'ANTHROPIC_API_KEY=paste-your-key-here' >> .env"
echo "Then start the app (it keeps running when you close this window):"
echo "  bash start-background.sh"
echo
echo "To keep your app safe on GitHub (optional, one time):  bash git-setup.sh"

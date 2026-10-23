#!/data/data/com.termux/files/usr/bin/bash
# One-time setup: connects this app folder to your GitHub account and uploads it there.
# Run it from the app folder:   bash git-setup.sh
# It never uploads your WhatsApp login (the data folder), your .env file or your keys.
set -e
cd "$(dirname "$0")"

say() { printf '\n== %s ==\n' "$1"; }

say "1/5  Getting git and the GitHub tool"
if command -v pkg >/dev/null 2>&1; then
  pkg install -y git gh || pkg install -y git || true
fi
command -v git >/dev/null 2>&1 || { echo "git is not installed. In Termux run:  pkg install git   then run this again."; exit 1; }

say "2/5  Your name for the save history"
if [ -z "$(git config --global user.name || true)" ]; then
  read -r -p "Your name (anything, e.g. Emmanuella): " NAME
  git config --global user.name "${NAME:-Postara}"
fi
if [ -z "$(git config --global user.email || true)" ]; then
  read -r -p "Your GitHub email: " EMAIL
  git config --global user.email "${EMAIL:-you@example.com}"
fi

say "3/5  Keeping private things off GitHub"
touch .gitignore
for line in node_modules data .env '*.log' '*.zip' .DS_Store; do
  grep -qxF "$line" .gitignore || echo "$line" >> .gitignore
done
echo "Your data folder, .env file, keys and zip files will not be uploaded."

if [ ! -d .git ]; then
  git init -q
  git symbolic-ref HEAD refs/heads/main
fi
git add -A
# stop if something private slipped in
if git diff --cached --name-only | grep -Eq '(^|/)(data/|\.env$)'; then
  git reset -q
  echo "Stopped: private files were about to be uploaded. Nothing was sent."
  exit 1
fi
VERSION="$(grep -m1 '"version"' package.json | sed 's/[^0-9.]//g')"
if ! git diff --cached --quiet; then
  git commit -q -m "Postara ${VERSION}"
  echo "Saved a first copy (version ${VERSION})."
fi

say "4/5  Logging in to GitHub"
HAVE_GH=0
if command -v gh >/dev/null 2>&1; then
  HAVE_GH=1
  if ! gh auth status >/dev/null 2>&1; then
    echo "GitHub will show a short code. Open the link it prints in Chrome, sign in, type the code, then come back here."
    gh auth login -h github.com -p https -w
  fi
  gh auth setup-git
fi

say "5/5  Putting the app on GitHub"
if git remote get-url origin >/dev/null 2>&1; then
  echo "This folder is already connected to: $(git remote get-url origin)"
elif [ "$HAVE_GH" = 1 ]; then
  read -r -p "Name for the new GitHub repository [whatsapp-poster]: " REPO
  REPO="${REPO:-whatsapp-poster}"
  gh repo create "$REPO" --private --source=. --remote=origin
else
  echo "The GitHub tool is not available, so do this by hand:"
  echo "  1. In Chrome go to github.com/new, make a repository (Private), and copy its address."
  echo "  2. Paste the address below."
  read -r -p "Repository address (https://github.com/you/name.git): " URL
  [ -n "$URL" ] || { echo "No address given."; exit 1; }
  git remote add origin "$URL"
  git config --global credential.helper store
  echo "When git asks for a password, paste a Personal Access Token (github.com/settings/tokens, tick 'repo'), not your normal password."
fi

BRANCH="$(git symbolic-ref --short HEAD)"
git push -u origin "$BRANCH"

echo
echo "Done. Your app is on GitHub: $(git remote get-url origin)"
echo "From now on, to save a change there:   bash push.sh \"what you changed\""

#!/data/data/com.termux/files/usr/bin/bash
# Saves your app files to GitHub in one go.
#   bash push.sh "what you changed"
# (Run  bash git-setup.sh  once first.)
cd "$(dirname "$0")" || exit 1

[ -d .git ] || { echo "Not set up yet. Run this once first:  bash git-setup.sh"; exit 1; }
git remote get-url origin >/dev/null 2>&1 || { echo "No GitHub repository is connected yet. Run:  bash git-setup.sh"; exit 1; }

MSG="${1:-Update}"
git add -A
# never upload private files
if git diff --cached --name-only | grep -Eq '(^|/)(data/|\.env$)'; then
  git reset -q
  echo "Stopped: private files (data folder or .env) were about to be uploaded. Nothing was sent."
  exit 1
fi
if git diff --cached --quiet; then
  echo "Nothing new to save."
else
  git commit -q -m "$MSG" && echo "Saved: $MSG"
fi

BRANCH="$(git symbolic-ref --short HEAD)"
if git push -u origin "$BRANCH"; then
  echo "Uploaded to GitHub."
else
  echo
  echo "The upload did not go through. If it says you are behind, run:  git pull --rebase   then  bash push.sh"
  echo "If it asks you to log in, run:  gh auth login   (or  bash git-setup.sh  again)."
  exit 1
fi

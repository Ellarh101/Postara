#!/data/data/com.termux/files/usr/bin/bash
# Starts the app and restarts it whenever it stops. Keeps the phone awake while it runs.
#   bash start.sh              runs here, in this window
#   bash start-background.sh   runs in the background (recommended: closing the window does not stop it)
cd "$(dirname "$0")"
export POSTER_SUPERVISED=1   # lets the app restart itself after an update
mkdir -p data
command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock
FAILS=0
while true; do
  # keep the log small: start a fresh one when it gets big
  [ -f data/app.log ] && [ "$(wc -c < data/app.log)" -gt 2000000 ] && mv data/app.log data/app.log.old
  START=$(date +%s)
  node src/index.js 2>&1 | tee -a data/app.log
  RAN=$(( $(date +%s) - START ))
  # If it keeps stopping straight away, wait longer each time (up to a minute) instead of spinning.
  if [ "$RAN" -lt 30 ]; then FAILS=$((FAILS + 1)); else FAILS=0; fi
  WAIT=$(( FAILS * 10 )); [ "$WAIT" -gt 60 ] && WAIT=60; [ "$WAIT" -lt 5 ] && WAIT=5
  echo "The app stopped. Restarting in ${WAIT} seconds. (Run  bash stop.sh  to stop it for good.)"
  sleep "$WAIT"
done

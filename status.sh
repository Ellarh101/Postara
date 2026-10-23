#!/data/data/com.termux/files/usr/bin/bash
# Tells you whether the app is running.
cd "$(dirname "$0")"
PORT_NUMBER="$(grep -E '^PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2)"; PORT_NUMBER="${PORT_NUMBER:-3000}"
if OUT="$(curl -fs "http://127.0.0.1:${PORT_NUMBER}/health" 2>/dev/null)"; then
  echo "Running.  $OUT"
  echo "Open: http://127.0.0.1:${PORT_NUMBER}"
else
  echo "NOT running. Start it with:  bash start-background.sh"
  [ -f data/app.log ] && { echo; echo "Last lines of the log:"; tail -n 8 data/app.log; }
fi

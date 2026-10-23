#!/data/data/com.termux/files/usr/bin/bash
# Starts the app in the background, so closing the Termux window does not stop it.
#   bash start-background.sh      start (does nothing if it is already running)
#   bash status.sh                check it
#   bash stop.sh                  stop it
cd "$(dirname "$0")"
mkdir -p data
PORT_NUMBER="$(grep -E '^PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2)"; PORT_NUMBER="${PORT_NUMBER:-3000}"
if curl -fs "http://127.0.0.1:${PORT_NUMBER}/health" >/dev/null 2>&1; then
  echo "Already running: http://127.0.0.1:${PORT_NUMBER}"
  exit 0
fi
command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock
nohup bash start.sh >> data/supervisor.log 2>&1 &
echo $! > data/supervisor.pid
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if curl -fs "http://127.0.0.1:${PORT_NUMBER}/health" >/dev/null 2>&1; then
    echo "Running. Open  http://127.0.0.1:${PORT_NUMBER}  in Chrome."
    exit 0
  fi
  sleep 1
done
echo "It was started but is not answering yet. Look at the last lines of data/app.log:"
tail -n 15 data/app.log 2>/dev/null

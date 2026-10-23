#!/data/data/com.termux/files/usr/bin/bash
# Stops the app (and its restarter) for good.
cd "$(dirname "$0")"
[ -f data/supervisor.pid ] && kill "$(cat data/supervisor.pid)" 2>/dev/null
pkill -f "bash start.sh" 2>/dev/null
pkill -f "node src/index.js" 2>/dev/null
rm -f data/supervisor.pid
command -v termux-wake-unlock >/dev/null 2>&1 && termux-wake-unlock
echo "Stopped."

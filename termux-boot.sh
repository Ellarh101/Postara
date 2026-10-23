#!/data/data/com.termux/files/usr/bin/bash
# One time: makes the app start by itself every time the phone starts.
# You need the free "Termux:Boot" app (install it from the same place you got Termux, F-Droid)
# and you must open Termux:Boot once after installing it.
cd "$(dirname "$0")"
APP_DIR="$(pwd)"
mkdir -p "$HOME/.termux/boot"
cat > "$HOME/.termux/boot/postara.sh" <<BOOT
#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock
cd "$APP_DIR" && bash start-background.sh
BOOT
chmod +x "$HOME/.termux/boot/postara.sh"
echo "Done. The app will now start on its own after the phone restarts."
echo "Remember: install Termux:Boot and open it once, or this does nothing."

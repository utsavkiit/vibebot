#!/usr/bin/env bash
# VibeBot setup script — run this once on your Mac mini.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLIST_NAME="com.vibebot.plist"
PLIST_SRC="$REPO_DIR/$PLIST_NAME"
PLIST_DEST="$HOME/Library/LaunchAgents/$PLIST_NAME"
LOG_DIR="$HOME/Library/Logs"

echo "=== VibeBot Setup ==="
echo ""

# 1. Install Python dependencies
echo "[1/4] Installing Python dependencies..."
pip3 install -r "$REPO_DIR/requirements.txt"
echo ""

# 2. Set up .env
if [ ! -f "$REPO_DIR/.env" ]; then
  cp "$REPO_DIR/.env.example" "$REPO_DIR/.env"
  echo "[2/4] Created .env from .env.example."
  echo "      !! Open $REPO_DIR/.env and fill in your API keys before continuing !!"
  echo ""
  read -rp "      Press Enter once you have filled in .env to continue..."
else
  echo "[2/4] .env already exists — skipping."
fi
echo ""

# 3. Update the plist with the correct Python path and repo path
PYTHON_PATH="$(which python3)"
PLIST_CONTENT="<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">
<plist version=\"1.0\">
<dict>
    <key>Label</key>
    <string>com.vibebot.daily</string>

    <key>ProgramArguments</key>
    <array>
        <string>$PYTHON_PATH</string>
        <string>$REPO_DIR/vibebot/main.py</string>
    </array>

    <key>WorkingDirectory</key>
    <string>$REPO_DIR</string>

    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>9</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>

    <!-- Run once at load if the scheduled time was missed today -->
    <key>RunAtLoad</key>
    <false/>

    <key>StandardOutPath</key>
    <string>$LOG_DIR/vibebot.log</string>

    <key>StandardErrorPath</key>
    <string>$LOG_DIR/vibebot.log</string>
</dict>
</plist>"

echo "[3/4] Installing launchd agent..."
echo "$PLIST_CONTENT" > "$PLIST_DEST"
echo "      Written to: $PLIST_DEST"
echo ""

# 4. Load the launchd agent
echo "[4/4] Loading launchd agent (will run daily at 9:00 AM)..."
# Unload first in case it was previously loaded
launchctl unload "$PLIST_DEST" 2>/dev/null || true
launchctl load "$PLIST_DEST"
echo ""

echo "=== Setup complete! ==="
echo ""
echo "Test it now:  launchctl start com.vibebot.daily"
echo "View logs:    tail -f $LOG_DIR/vibebot.log"
echo "Run manually: python3 $REPO_DIR/vibebot/main.py"
echo ""

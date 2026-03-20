#!/usr/bin/env bash
# VibeBot setup script — run this once on your Mac mini.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLIST_NAME="com.vibebot.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/$PLIST_NAME"
LOG_DIR="$HOME/Library/Logs"

echo "=== VibeBot Setup ==="
echo ""

# 1. Install Node dependencies
echo "[1/5] Installing Node dependencies..."
npm install --prefix "$REPO_DIR"
echo ""

# 2. Build TypeScript
echo "[2/5] Building TypeScript..."
npm run build --prefix "$REPO_DIR"
echo ""

# 3. Set up .env
if [ ! -f "$REPO_DIR/.env" ]; then
  cp "$REPO_DIR/.env.example" "$REPO_DIR/.env"
  echo "[3/5] Created .env from .env.example."
  echo "      !! Open $REPO_DIR/.env and fill in your API keys before continuing !!"
  echo ""
  read -rp "      Press Enter once you have filled in .env to continue..."
else
  echo "[3/5] .env already exists — skipping."
fi
echo ""

# 4. Install the launchd agent
NODE_PATH="$(which node)"
PLIST_CONTENT="<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">
<plist version=\"1.0\">
<dict>
    <key>Label</key>
    <string>com.vibebot.daily</string>

    <key>ProgramArguments</key>
    <array>
        <string>$NODE_PATH</string>
        <string>$REPO_DIR/dist/main.js</string>
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

    <key>RunAtLoad</key>
    <false/>

    <key>StandardOutPath</key>
    <string>$LOG_DIR/vibebot.log</string>

    <key>StandardErrorPath</key>
    <string>$LOG_DIR/vibebot.log</string>
</dict>
</plist>"

echo "[4/5] Installing launchd agent..."
echo "$PLIST_CONTENT" > "$PLIST_DEST"
echo "      Written to: $PLIST_DEST"
echo ""

# 5. Load the launchd agent
echo "[5/5] Loading launchd agent (will run daily at 9:00 AM)..."
launchctl unload "$PLIST_DEST" 2>/dev/null || true
launchctl load "$PLIST_DEST"
echo ""

echo "=== Setup complete! ==="
echo ""
echo "Test it now:  launchctl start com.vibebot.daily"
echo "View logs:    tail -f $LOG_DIR/vibebot.log"
echo "Run manually: npm start"
echo ""

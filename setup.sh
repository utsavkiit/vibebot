#!/usr/bin/env bash
# VibeBot setup script — run once on a new Mac mini (Apple Silicon).
# Usage: bash setup.sh
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
LOG_DIR="$HOME/Library/Logs"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

step() { echo -e "\n${GREEN}[$1]${NC} $2"; }
warn() { echo -e "${YELLOW}  !! $1${NC}"; }

echo "=== VibeBot Setup ==="

# ---------------------------------------------------------------------------
# 1. Homebrew
# ---------------------------------------------------------------------------
step "1/9" "Checking Homebrew..."
if ! command -v brew &>/dev/null; then
  warn "Homebrew not found — installing..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
echo "  Homebrew: $(brew --version | head -1)"

# ---------------------------------------------------------------------------
# 2. Node.js
# ---------------------------------------------------------------------------
step "2/9" "Checking Node.js..."
if ! command -v node &>/dev/null; then
  warn "Node.js not found — installing via Homebrew..."
  brew install node
fi
echo "  Node: $(node --version)  npm: $(npm --version)"

# ---------------------------------------------------------------------------
# 3. npm dependencies
# ---------------------------------------------------------------------------
step "3/9" "Installing npm dependencies..."
cd "$REPO_DIR"
npm install
echo "  Done."

# ---------------------------------------------------------------------------
# 4. Ollama + models
# ---------------------------------------------------------------------------
step "4/9" "Checking Ollama..."
if ! command -v ollama &>/dev/null; then
  warn "Ollama not found — installing..."
  brew install ollama
fi
echo "  Ollama: $(ollama --version)"

echo "  Pulling qwen3:8b (LLM — may take a few minutes on first run)..."
ollama pull qwen3:8b

echo "  Pulling nomic-embed-text (embeddings)..."
ollama pull nomic-embed-text

# ---------------------------------------------------------------------------
# 5. ffmpeg
# ---------------------------------------------------------------------------
step "5/9" "Checking ffmpeg..."
if ! command -v ffmpeg &>/dev/null; then
  warn "ffmpeg not found — installing..."
  brew install ffmpeg
fi
echo "  ffmpeg: $(ffmpeg -version 2>&1 | head -1)"

# ---------------------------------------------------------------------------
# 6. uv + mlx-audio (Kokoro TTS)
# ---------------------------------------------------------------------------
step "6/9" "Checking uv + mlx-audio..."
if ! command -v uv &>/dev/null; then
  warn "uv not found — installing..."
  brew install uv
fi
echo "  uv: $(uv --version)"

echo "  Installing mlx-audio with all required extras..."
uv tool install mlx-audio \
  --with uvicorn \
  --with fastapi \
  --with setuptools \
  --with python-multipart \
  --with webrtcvad \
  --with "misaki[en]" \
  --with num2words \
  --with "en_core_web_sm @ https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl"

# Patch webrtcvad to remove legacy pkg_resources dependency
WEBRTCVAD_PATH="$(find "$HOME/.local/share/uv/tools/mlx-audio" -name "webrtcvad.py" 2>/dev/null | head -1)"
if [ -n "$WEBRTCVAD_PATH" ] && grep -q "pkg_resources" "$WEBRTCVAD_PATH"; then
  sed -i '' 's/import pkg_resources//' "$WEBRTCVAD_PATH"
  sed -i '' "s/__version__ = pkg_resources.get_distribution('webrtcvad').version/__version__ = \"2.0.10\"/" "$WEBRTCVAD_PATH"
  echo "  Patched webrtcvad.py (removed pkg_resources dependency)."
fi

# ---------------------------------------------------------------------------
# 7. Tailscale
# ---------------------------------------------------------------------------
step "7/9" "Checking Tailscale..."
if ! command -v tailscale &>/dev/null; then
  warn "Tailscale not found — installing..."
  brew install tailscale
  warn "Run 'sudo tailscaled &' then 'tailscale up' to connect this machine."
  warn "Also install the Tailscale app on your phone and sign in with the same account."
  warn "Then update 'serve_url' in config.yaml with your Mac mini's Tailscale IP."
  warn "Run 'tailscale ip --4' after connecting to get the IP."
else
  TAILSCALE_IP="$(tailscale ip --4 2>/dev/null || echo 'not connected')"
  echo "  Tailscale IP: $TAILSCALE_IP"
  if [ "$TAILSCALE_IP" != "not connected" ]; then
    # Auto-update serve_url in config.yaml
    sed -i '' "s|serve_url: \"http://.*:8888\"|serve_url: \"http://$TAILSCALE_IP:8888\"|" "$REPO_DIR/config.yaml"
    echo "  Updated config.yaml serve_url → http://$TAILSCALE_IP:8888"
  fi
fi

# ---------------------------------------------------------------------------
# 8. .env
# ---------------------------------------------------------------------------
step "8/9" "Checking .env..."
if [ ! -f "$REPO_DIR/.env" ]; then
  cp "$REPO_DIR/.env.example" "$REPO_DIR/.env"
  warn "Created .env from .env.example."
  warn "Open $REPO_DIR/.env and fill in your API keys, then press Enter."
  read -rp "  Press Enter once .env is filled in..."
else
  echo "  .env already exists — skipping."
fi

# ---------------------------------------------------------------------------
# 9. Build + launchd agents
# ---------------------------------------------------------------------------
step "9/9" "Building TypeScript and installing launchd agents..."
npm run build

bash "$REPO_DIR/scripts/install_launchd.sh"

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo -e "\n=== Setup complete! ===\n"
echo ""
echo "Test a plugin now:"
echo "  node dist/main.js --plugin us_news"
echo ""
echo "View logs:"
echo "  tail -f $LOG_DIR/vibebot-us_news.log"
echo "  tail -f $LOG_DIR/vibebot-podcast.log"
echo ""
echo "Podcast files:"
echo "  ls -lh ~/VibeBot-Podcasts/"
echo ""

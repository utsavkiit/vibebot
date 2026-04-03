#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
LOG_DIR="$HOME/Library/Logs"
PODCAST_DIR="$HOME/VibeBot-Podcasts"
UID_VALUE="$(id -u)"

PLISTS=(
  "com.vibebot.plist"
  "launchd/com.vibebot.us_news.plist"
  "launchd/com.vibebot.world_news.plist"
  "launchd/com.vibebot.india_news.plist"
  "launchd/com.vibebot.sports.plist"
  "launchd/com.vibebot.tech_news.plist"
  "launchd/com.vibebot.stocks_news.plist"
  "launchd/com.vibebot.podcast.plist"
  "launchd/com.vibebot.mlx-audio.plist"
  "launchd/com.vibebot.podcast-server.plist"
)

bootstrap_plist() {
  local dest="$1"

  launchctl bootout "gui/$UID_VALUE" "$dest" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$UID_VALUE" "$dest"
}

main() {
  mkdir -p "$LAUNCH_AGENTS" "$LOG_DIR" "$PODCAST_DIR"

  for relative_path in "${PLISTS[@]}"; do
    local_src="$REPO_DIR/$relative_path"
    local_dest="$LAUNCH_AGENTS/$(basename "$relative_path")"

    if [[ ! -f "$local_src" ]]; then
      echo "Missing plist: $local_src" >&2
      continue
    fi

    cp "$local_src" "$local_dest"
    bootstrap_plist "$local_dest"
    echo "Installed: $(basename "$local_dest" .plist)"
  done

  echo
  echo "Active launchd jobs:"
  launchctl list | grep vibebot || true
}

main "$@"

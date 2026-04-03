#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
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

reload_plist() {
  local dest="$1"

  if [[ ! -f "$dest" ]]; then
    echo "Not installed: $dest" >&2
    return 1
  fi

  launchctl bootout "gui/$UID_VALUE" "$dest" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$UID_VALUE" "$dest"
  echo "Reloaded: $(basename "$dest" .plist)"
}

main() {
  local failures=0

  for relative_path in "${PLISTS[@]}"; do
    local_src="$REPO_DIR/$relative_path"
    local_dest="$LAUNCH_AGENTS/$(basename "$relative_path")"

    if [[ ! -f "$local_src" ]]; then
      echo "Missing plist: $local_src" >&2
      failures=1
      continue
    fi

    cp "$local_src" "$local_dest"

    if ! reload_plist "$local_dest"; then
      failures=1
    fi
  done

  echo
  echo "Active launchd jobs:"
  launchctl list | grep vibebot || true

  return "$failures"
}

main "$@"

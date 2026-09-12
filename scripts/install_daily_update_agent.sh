#!/bin/bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PRODUCTION_ROOT="${APP3_PRODUCTION_ROOT:-}"
LABEL="com.app3tester.daily-update"
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"
TEMPLATE="$REPO_ROOT/launchd/$LABEL.plist.template"

if [[ -z "$PRODUCTION_ROOT" ]]; then
  echo "Ange den privata App3-roten i APP3_PRODUCTION_ROOT." >&2
  echo "Exempel: APP3_PRODUCTION_ROOT=/sökväg/till/workspace bash scripts/install_daily_update_agent.sh" >&2
  exit 2
fi
if [[ ! -f "$PRODUCTION_ROOT/scripts/app3_export_public_signal.py" ]]; then
  echo "Ingen App3 public-signal-exporter hittades i angiven production-root." >&2
  exit 2
fi

mkdir -p "$HOME/Library/LaunchAgents" "$REPO_ROOT/data/logs"
escape_sed() { printf '%s' "$1" | sed 's/[&|]/\\&/g'; }
REPO_ESCAPED="$(escape_sed "$REPO_ROOT")"
PRODUCTION_ESCAPED="$(escape_sed "$PRODUCTION_ROOT")"
sed -e "s|__REPO_PATH__|$REPO_ESCAPED|g" \
  -e "s|__PRODUCTION_ROOT__|$PRODUCTION_ESCAPED|g" \
  "$TEMPLATE" > "$TARGET"

DOMAIN="gui/$(id -u)"
launchctl bootout "$DOMAIN" "$TARGET" >/dev/null 2>&1 || true
launchctl bootstrap "$DOMAIN" "$TARGET"
launchctl enable "$DOMAIN/$LABEL"

echo "Installerad: $TARGET"
echo "Schema: dagligen 07:15 Europe/Stockholm"
echo "Status: launchctl print $DOMAIN/$LABEL"
echo "Loggar: $REPO_ROOT/data/logs/app3_tester_daily.out.log"

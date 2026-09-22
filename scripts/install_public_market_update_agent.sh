#!/bin/bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.app3tester.public-market-update"
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"
TEMPLATE="$REPO_ROOT/launchd/$LABEL.plist.template"
LOG_DIR="$HOME/Library/Logs/app3-tester"

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"
escape_sed() { printf '%s' "$1" | sed 's/[&|]/\\&/g'; }
REPO_ESCAPED="$(escape_sed "$REPO_ROOT")"
LOG_ESCAPED="$(escape_sed "$LOG_DIR")"
sed -e "s|__REPO_PATH__|$REPO_ESCAPED|g" -e "s|__LOG_DIR__|$LOG_ESCAPED|g" "$TEMPLATE" > "$TARGET"

DOMAIN="gui/$(id -u)"
launchctl bootout "$DOMAIN" "$TARGET" >/dev/null 2>&1 || true
launchctl bootstrap "$DOMAIN" "$TARGET"
launchctl enable "$DOMAIN/$LABEL"

echo "Installerad: $TARGET"
echo "Schema: vardagar 22:15 Europe/Stockholm"
echo "Status: launchctl print $DOMAIN/$LABEL"
echo "Manuell körning: bash $REPO_ROOT/scripts/update_public_market_data.sh"
echo "Loggar: $LOG_DIR/app3_tester_public_market.out.log och .err.log"

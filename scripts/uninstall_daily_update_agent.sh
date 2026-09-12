#!/bin/bash
set -euo pipefail

LABEL="com.app3tester.daily-update"
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

launchctl bootout "$DOMAIN" "$TARGET" >/dev/null 2>&1 || true
rm -f "$TARGET"
echo "Avinstallerad: $LABEL"

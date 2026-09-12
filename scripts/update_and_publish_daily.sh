#!/bin/bash
set -euo pipefail

PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export PATH
export TZ="Europe/Stockholm"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PRODUCTION_ROOT="${APP3_PRODUCTION_ROOT:-}"
DRY_RUN=false

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
elif [[ -n "${1:-}" ]]; then
  echo "Okänt argument: $1" >&2
  exit 2
fi

if [[ -z "$PRODUCTION_ROOT" ]]; then
  echo "APP3_PRODUCTION_ROOT saknas. Installera LaunchAgent med den privata App3-sökvägen." >&2
  exit 2
fi

SIGNAL_EXPORTER="$PRODUCTION_ROOT/scripts/app3_export_public_signal.py"
DECISION_FILE="$PRODUCTION_ROOT/data/processed/decision_v1.json"
if [[ ! -f "$SIGNAL_EXPORTER" || ! -f "$DECISION_FILE" ]]; then
  echo "App3 production-exporter eller decision_v1.json saknas under APP3_PRODUCTION_ROOT." >&2
  exit 2
fi

PYTHON_BIN="${PYTHON_BIN:-$(command -v python3)}"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
NPM_BIN="${NPM_BIN:-$(command -v npm)}"
GIT_BIN="${GIT_BIN:-$(command -v git)}"

cd "$REPO_ROOT"

if $DRY_RUN; then
  TEMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$TEMP_DIR"' EXIT
  SIGNAL_OUTPUT="$TEMP_DIR/app3_signal.json"
  BENCHMARK_OUTPUT="$TEMP_DIR/benchmark_series.json"
else
  if [[ "$($GIT_BIN branch --show-current)" != "main" ]]; then
    echo "Daglig publicering kräver branch main." >&2
    exit 1
  fi
  if [[ -n "$($GIT_BIN status --porcelain)" ]]; then
    echo "Daglig publicering stoppad: repot har lokala ändringar." >&2
    exit 1
  fi
  "$GIT_BIN" pull --ff-only origin main
  SIGNAL_OUTPUT="$REPO_ROOT/data/app3_signal.json"
  BENCHMARK_OUTPUT="$REPO_ROOT/data/benchmark_series.json"
fi

"$PYTHON_BIN" "$SIGNAL_EXPORTER" \
  --input "$DECISION_FILE" \
  --output "$SIGNAL_OUTPUT"
"$PYTHON_BIN" "$REPO_ROOT/scripts/export_public_benchmarks.py" \
  --output "$BENCHMARK_OUTPUT"
"$NODE_BIN" "$REPO_ROOT/scripts/validate-data.mjs" "$SIGNAL_OUTPUT" "$BENCHMARK_OUTPUT"

if $DRY_RUN; then
  echo "DRY RUN OK: signal, ETF-kurser och EUR/SEK validerades. Inget publicerades."
  exit 0
fi

"$NPM_BIN" test

while IFS= read -r changed_file; do
  case "$changed_file" in
    data/app3_signal.json|data/benchmark_series.json) ;;
    *) echo "Oväntad fil ändrades: $changed_file" >&2; exit 1 ;;
  esac
done < <("$GIT_BIN" diff --name-only)

if "$GIT_BIN" diff --quiet -- data/app3_signal.json data/benchmark_series.json; then
  echo "Ingen ny publik data att publicera."
  exit 0
fi

"$GIT_BIN" add -- data/app3_signal.json data/benchmark_series.json
"$GIT_BIN" commit -m "Update App3 public data $(date +%F)"
"$GIT_BIN" push origin main
echo "App3 Tester-data publicerad. GitHub Pages deploy startar via Actions."

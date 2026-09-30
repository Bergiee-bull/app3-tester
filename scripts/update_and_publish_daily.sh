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
FEEDBACK_FILE="$PRODUCTION_ROOT/data/processed/app3_signal_feedback.json"
MARKET_SERIES="$PRODUCTION_ROOT/data/outputs/app1/rotation_live/rotation_live_series.csv"
HISTORY_EXPORTER="$REPO_ROOT/scripts/export_public_strategy_history.py"
if [[ ! -f "$SIGNAL_EXPORTER" || ! -f "$DECISION_FILE" || ! -f "$FEEDBACK_FILE" || ! -f "$MARKET_SERIES" ]]; then
  echo "App3 production-exporter, decision_v1.json, signal feedback eller marknadsserie saknas under APP3_PRODUCTION_ROOT." >&2
  exit 2
fi

PYTHON_BIN="${PYTHON_BIN:-$(command -v python3)}"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
NPM_BIN="${NPM_BIN:-$(command -v npm)}"
GIT_BIN="${GIT_BIN:-$(command -v git)}"

REPO_STARTED_CLEAN=false
PUBLISH_FILES=(data/app3_signal.json data/benchmark_series.json data/app3_strategy_history.json)
GENERATED_FILES=()
cleanup() {
  local status=$?
  if [[ -n "${TEMP_DIR:-}" && -d "$TEMP_DIR" ]]; then rm -rf "$TEMP_DIR"; fi
  if [[ -n "${BENCHMARK_CANDIDATE:-}" && -f "$BENCHMARK_CANDIDATE" && -z "${TEMP_DIR:-}" ]]; then
    rm -f "$BENCHMARK_CANDIDATE"
  fi
  if [[ $status -ne 0 && "$REPO_STARTED_CLEAN" == true && ${#GENERATED_FILES[@]} -gt 0 ]]; then
    "$GIT_BIN" restore --staged --worktree -- "${GENERATED_FILES[@]}" || true
  fi
  trap - EXIT
  exit "$status"
}
trap cleanup EXIT

cd "$REPO_ROOT"

if $DRY_RUN; then
  TEMP_DIR="$(mktemp -d)"
  SIGNAL_OUTPUT="$TEMP_DIR/app3_signal.json"
  BENCHMARK_OUTPUT="$TEMP_DIR/benchmark_series.json"
  BENCHMARK_CANDIDATE="$BENCHMARK_OUTPUT"
  HISTORY_OUTPUT="$TEMP_DIR/app3_strategy_history.json"
else
  if [[ "$($GIT_BIN branch --show-current)" != "main" ]]; then
    echo "Daglig publicering kräver branch main." >&2
    exit 1
  fi
  if [[ -n "$($GIT_BIN status --porcelain)" ]]; then
    echo "Daglig publicering stoppad: repot har lokala ändringar." >&2
    exit 1
  fi
  REPO_STARTED_CLEAN=true
  "$GIT_BIN" pull --ff-only origin main
  SIGNAL_OUTPUT="$REPO_ROOT/data/app3_signal.json"
  BENCHMARK_OUTPUT="$REPO_ROOT/data/benchmark_series.json"
  BENCHMARK_CANDIDATE="$(mktemp)"
  HISTORY_OUTPUT="$REPO_ROOT/data/app3_strategy_history.json"
fi

if ! $DRY_RUN; then GENERATED_FILES+=(data/app3_signal.json); fi
"$PYTHON_BIN" "$SIGNAL_EXPORTER" \
  --input "$DECISION_FILE" \
  --output "$SIGNAL_OUTPUT"
"$PYTHON_BIN" "$REPO_ROOT/scripts/export_public_benchmarks.py" \
  --output "$BENCHMARK_CANDIDATE"
if ! $DRY_RUN; then GENERATED_FILES+=(data/app3_strategy_history.json); fi
"$PYTHON_BIN" "$HISTORY_EXPORTER" \
  --feedback "$FEEDBACK_FILE" \
  --decision "$DECISION_FILE" \
  --market-series "$MARKET_SERIES" \
  --output "$HISTORY_OUTPUT"
"$NODE_BIN" "$REPO_ROOT/scripts/validate-data.mjs" "$SIGNAL_OUTPUT" "$BENCHMARK_CANDIDATE" "$HISTORY_OUTPUT"

if ! $DRY_RUN; then
  GENERATED_FILES+=(data/benchmark_series.json)
  "$PYTHON_BIN" "$REPO_ROOT/scripts/promote_public_benchmark.py" \
    --candidate "$BENCHMARK_CANDIDATE" \
    --target "$BENCHMARK_OUTPUT"
fi

if $DRY_RUN; then
  BENCHMARK_OUTPUT="$BENCHMARK_CANDIDATE"
fi

"$NODE_BIN" "$REPO_ROOT/scripts/validate-data.mjs" "$SIGNAL_OUTPUT" "$BENCHMARK_OUTPUT" "$HISTORY_OUTPUT"

if $DRY_RUN; then
  echo "DRY RUN OK: signal, ETF-kurser och EUR/SEK validerades. Inget publicerades."
  exit 0
fi

"$NPM_BIN" test

while IFS= read -r changed_file; do
  case "$changed_file" in
    data/app3_signal.json|data/benchmark_series.json|data/app3_strategy_history.json) ;;
    *) echo "Oväntad fil ändrades: $changed_file" >&2; exit 1 ;;
  esac
done < <("$GIT_BIN" diff --name-only)

if "$GIT_BIN" diff --quiet -- "${PUBLISH_FILES[@]}"; then
  echo "Ingen ny publik data att publicera."
  "$NODE_BIN" "$REPO_ROOT/scripts/app3_publish_switch_notification.mjs"
  exit 0
fi

"$GIT_BIN" add -- "${PUBLISH_FILES[@]}"
"$GIT_BIN" commit -m "Update App3 public data $(date +%F)"
"$GIT_BIN" push origin main
echo "App3 Tester-data publicerad. GitHub Pages deploy startar via Actions."
"$NODE_BIN" "$REPO_ROOT/scripts/app3_publish_switch_notification.mjs"

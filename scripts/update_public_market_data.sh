#!/bin/bash
set -euo pipefail

PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export PATH
export TZ="Europe/Stockholm"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
elif [[ -n "${1:-}" ]]; then
  echo "Okänt argument: $1" >&2
  exit 2
fi

PYTHON_BIN="${PYTHON_BIN:-$(command -v python3)}"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
NPM_BIN="${NPM_BIN:-$(command -v npm)}"
GIT_BIN="${GIT_BIN:-$(command -v git)}"
STATUS_FILE="$REPO_ROOT/data/public_market_update_status.json"
TARGET_FILE="$REPO_ROOT/data/benchmark_series.json"
TEMP_DIR="$(mktemp -d)"
CANDIDATE_FILE="$TEMP_DIR/benchmark_series.json"
REPO_WAS_CLEAN=false
GENERATED_FILES=()
cleanup() {
  local status=$?
  rm -rf "$TEMP_DIR"
  if [[ $status -ne 0 && "$REPO_WAS_CLEAN" == true && ${#GENERATED_FILES[@]} -gt 0 ]]; then
    "$GIT_BIN" restore --staged --worktree -- "${GENERATED_FILES[@]}" || true
  fi
  trap - EXIT
  exit "$status"
}
trap cleanup EXIT

write_status() {
  local -a args=(
    --output "$STATUS_FILE"
    --benchmark "${1:-$TARGET_FILE}"
    --current "$TARGET_FILE"
    --status "${2:-auto}"
  )
  if [[ -n "${3:-}" ]]; then args+=(--error "$3"); fi
  "$PYTHON_BIN" "$REPO_ROOT/scripts/write_public_market_status.py" "${args[@]}"
}

privacy_check() {
  while IFS= read -r changed_file; do
    case "$changed_file" in
      data/benchmark_series.json|data/public_market_update_status.json) ;;
      *) echo "Public market update försökte ändra otillåten fil: $changed_file" >&2; return 1 ;;
    esac
  done < <("$GIT_BIN" diff --name-only)
  if git diff -- data/benchmark_series.json data/public_market_update_status.json | grep -Eiq '(/Users/|telegram|token|secret|quantity|purchase_price|current_value|decision_v1|current_position)'; then
    echo "Privacy scan blockerade public market update." >&2
    return 1
  fi
}

run_update() {
  cd "$REPO_ROOT" || return 1
  if ! $DRY_RUN; then
    [[ "$($GIT_BIN branch --show-current)" == "main" ]] || { echo "Public market update kräver branch main." >&2; return 1; }
    [[ -z "$($GIT_BIN status --porcelain)" ]] || { echo "Public market update stoppad: repot har lokala ändringar." >&2; return 1; }
    REPO_WAS_CLEAN=true
    "$GIT_BIN" pull --ff-only origin main || return 1
  fi

  "$PYTHON_BIN" "$REPO_ROOT/scripts/export_public_benchmarks.py" --output "$CANDIDATE_FILE" || return 1
  "$NODE_BIN" "$REPO_ROOT/scripts/validate-data.mjs" \
    "$REPO_ROOT/data/app3_signal.json" "$CANDIDATE_FILE" "$REPO_ROOT/data/app3_strategy_history.json" || return 1

  if ! $DRY_RUN; then
    GENERATED_FILES+=(data/benchmark_series.json)
    "$PYTHON_BIN" "$REPO_ROOT/scripts/promote_public_benchmark.py" --candidate "$CANDIDATE_FILE" --target "$TARGET_FILE" || return 1
    GENERATED_FILES+=(data/public_market_update_status.json)
    write_status "$CANDIDATE_FILE" auto || return 1
    "$NODE_BIN" "$REPO_ROOT/scripts/validate-data.mjs" || return 1
    "$NPM_BIN" test || return 1
    privacy_check || return 1
    "$GIT_BIN" diff --check || return 1
    if ! "$GIT_BIN" diff --quiet -- data/benchmark_series.json data/public_market_update_status.json; then
      "$GIT_BIN" add -- data/benchmark_series.json data/public_market_update_status.json || return 1
      "$GIT_BIN" commit -m "Update App3 public market data $(date +%F)" || return 1
      "$GIT_BIN" push origin main || return 1
    fi
  else
    "$PYTHON_BIN" "$REPO_ROOT/scripts/write_public_market_status.py" \
      --output "$TEMP_DIR/public_market_update_status.json" \
      --benchmark "$CANDIDATE_FILE" --current "$TARGET_FILE" --status auto || return 1
    echo "DRY RUN OK: senaste gemensamma marknadsdag $(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["latest_common_market_date"])' "$CANDIDATE_FILE"). Ingen publicering."
  fi
}

if run_update; then
  echo "Public market update klar: endast benchmark/status, ingen App3-strategi eller portfölj ändrad."
  exit 0
fi

failure_message="Public market update misslyckades. Tidigare verifierad benchmarkdata behålls."
echo "$failure_message" >&2
exit 1

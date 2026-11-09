#!/usr/bin/env bash
set -euo pipefail

# Retry only the transient bundle-download failures observed on hosted runners.
# Compiler, configuration, signing and other HTTP errors must fail immediately.
retry_delay=${NR_TAURI_RETRY_DELAY:-5}
if [[ ! "$retry_delay" =~ ^[0-9]{1,2}$ ]] || (( 10#$retry_delay > 60 )); then
  echo "NR_TAURI_RETRY_DELAY must be an integer from 0 to 60" >&2
  exit 2
fi
build_log=$(mktemp)
trap 'rm -f "$build_log"' EXIT

for attempt in 1 2 3; do
  if npx tauri build "$@" 2>&1 | tee "$build_log"; then
    exit 0
  else
    build_status=$?
  fi
  if (( attempt == 3 )) || ! grep -Eq 'failed to bundle project:.*http status: (502|503|504)' "$build_log"; then
    exit "$build_status"
  fi
  echo "[tauri-ci] Transient bundle download failure; retry $((attempt + 1))/3 in ${retry_delay}s" >&2
  sleep "$retry_delay"
done

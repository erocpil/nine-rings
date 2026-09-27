#!/usr/bin/env bash
# Run one command with repository-local tools, without changing the login shell.
set -euo pipefail
NR_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export CARGO_HOME="$NR_ROOT/.local-tools/cargo"
export RUSTUP_HOME="$NR_ROOT/.local-tools/rustup"
export CARGO_TARGET_DIR="$NR_ROOT/.local-tools/target"
export npm_config_cache="$NR_ROOT/.local-tools/npm-cache"
export PLAYWRIGHT_BROWSERS_PATH="$NR_ROOT/.local-tools/playwright"
NR_NODE_VERSION="$(cat "$NR_ROOT/.node-version")"
if [[ ! -x "$NR_ROOT/.local-tools/node-v$NR_NODE_VERSION/bin/node" || ! -x "$CARGO_HOME/bin/rustup" ]]; then
  echo "Missing local tools. Run: bash scripts/install-local-tools.sh" >&2
  exit 1
fi
export PATH="$NR_ROOT/.local-tools/node-v$NR_NODE_VERSION/bin:$CARGO_HOME/bin:$NR_ROOT/.local-tools/python/bin:$PATH"
if [[ $# -eq 0 ]]; then
  echo "Usage: bash scripts/with-local-tools.sh <command> [arguments...]" >&2
  exit 2
fi
exec "$@"

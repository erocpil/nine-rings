#!/usr/bin/env bash
# Use a user-owned Flutter checkout without changing system PATH or installing SDKs.
set -euo pipefail
NR_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NR_FLUTTER_SDK="${NR_FLUTTER_ROOT:-$HOME/src/flutter}"
if [[ ! -x "$NR_FLUTTER_SDK/bin/flutter" ]]; then
  echo "Missing Flutter checkout: set NR_FLUTTER_ROOT to its directory." >&2
  exit 1
fi
export CI=true
export FLUTTER_SUPPRESS_ANALYTICS=true
export DART_SUPPRESS_ANALYTICS=1
# The test VM uses local WebSockets; preserve remote proxies but bypass loopback.
export NO_PROXY="${NO_PROXY:+$NO_PROXY,}localhost,127.0.0.1,::1"
export no_proxy="$NO_PROXY"
export PUB_CACHE="$NR_ROOT/.local-tools/flutter-pub"
export XDG_CONFIG_HOME="$NR_ROOT/.local-tools/flutter-config"
mkdir -p "$PUB_CACHE" "$XDG_CONFIG_HOME"
if [[ "${1:-}" == "--project" ]]; then
  shift
  cd "$NR_ROOT/flutter_app"
fi
if [[ "${1:-}" == "dart" ]]; then
  shift
  exec "$NR_FLUTTER_SDK/bin/cache/dart-sdk/bin/dart" "$@"
fi
exec "$NR_FLUTTER_SDK/bin/flutter" "$@"

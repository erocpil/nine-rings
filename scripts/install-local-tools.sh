#!/usr/bin/env bash
# macOS/Linux bootstrap. No sudo, shell-profile edits, or global npm packages.
set -euo pipefail
NR_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NR_TOOLS="$NR_ROOT/.local-tools"
mkdir -p "$NR_TOOLS/downloads" "$NR_TOOLS/logs"
exec > >(tee -a "$NR_TOOLS/logs/install.log") 2>&1
date -u '+Installation started: %Y-%m-%dT%H:%M:%SZ'
NR_NODE_VERSION="$(cat "$NR_ROOT/.node-version")"
NR_RUST_VERSION="$(sed -n 's/^channel = "\([^"]*\)"/\1/p' "$NR_ROOT/rust-toolchain.toml")"
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) NR_PLATFORM=darwin-arm64 ;;
  Darwin-x86_64) NR_PLATFORM=darwin-x64 ;;
  Linux-x86_64) NR_PLATFORM=linux-x64 ;;
  Linux-aarch64) NR_PLATFORM=linux-arm64 ;;
  *) echo 'Unsupported host; use the documented CI toolchain setup.' >&2; exit 1 ;;
esac
if [[ ! -x "$NR_TOOLS/node-v$NR_NODE_VERSION/bin/node" ]]; then
  NR_ARCHIVE="node-v$NR_NODE_VERSION-$NR_PLATFORM.tar.gz"
  curl -fL --retry 3 "https://nodejs.org/dist/v$NR_NODE_VERSION/$NR_ARCHIVE" -o "$NR_TOOLS/downloads/$NR_ARCHIVE"
  curl -fL --retry 3 "https://nodejs.org/dist/v$NR_NODE_VERSION/SHASUMS256.txt" -o "$NR_TOOLS/downloads/node-SHASUMS256.txt"
  (
    cd "$NR_TOOLS/downloads"
    awk -v name="$NR_ARCHIVE" '$2 == name {print; found=1} END {if (!found) exit 1}' node-SHASUMS256.txt > node-checksum.txt
    if command -v sha256sum >/dev/null; then sha256sum -c node-checksum.txt; else shasum -a 256 -c node-checksum.txt; fi
    tar -xzf "$NR_ARCHIVE" -C "$NR_TOOLS"
  )
  mv "$NR_TOOLS/node-v$NR_NODE_VERSION-$NR_PLATFORM" "$NR_TOOLS/node-v$NR_NODE_VERSION"
fi
export CARGO_HOME="$NR_TOOLS/cargo"
export RUSTUP_HOME="$NR_TOOLS/rustup"
if [[ ! -x "$CARGO_HOME/bin/rustup" ]]; then
  curl -fL --retry 3 https://sh.rustup.rs -o "$NR_TOOLS/downloads/rustup-init.sh"
  sh "$NR_TOOLS/downloads/rustup-init.sh" -y --no-modify-path --profile minimal --default-toolchain "$NR_RUST_VERSION"
fi
"$CARGO_HOME/bin/rustup" toolchain install "$NR_RUST_VERSION" --profile minimal --component rustfmt,clippy
# Virtual environments contain absolute paths, so recreate rather than copy /tmp.
if [[ ! -x "$NR_TOOLS/python/bin/python" ]]; then python3 -m venv "$NR_TOOLS/python"; fi
"$NR_TOOLS/python/bin/python" -m pip install 'PyYAML==6.0.3'
bash "$NR_ROOT/scripts/with-local-tools.sh" node --version
bash "$NR_ROOT/scripts/with-local-tools.sh" npm --version
bash "$NR_ROOT/scripts/with-local-tools.sh" rustc --version
bash "$NR_ROOT/scripts/with-local-tools.sh" cargo --version
date -u '+Installation finished: %Y-%m-%dT%H:%M:%SZ'

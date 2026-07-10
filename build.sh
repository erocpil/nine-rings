#!/usr/bin/env bash
set -euo pipefail

# ── Nine Rings 构建脚本 ──
# 用法: ./build.sh [dev|release|web|clean]
#   dev     — debug 编译（默认）
#   release — release 编译（优化，较慢）
#   web     — 构建 Web 版（产物 dist/）
#   clean   — 清理编译产物

PROXY=http://172.16.1.135:3128
CARGO_DIR="$HOME/.cargo/bin"

export PATH="$CARGO_DIR:$PATH"
export http_proxy="$PROXY"
export https_proxy="$PROXY"

MODE="${1:-dev}"

case "$MODE" in
  dev)
    echo "▸ debug 编译 nine-rings (desktop)..."
    cd "$(dirname "$0")/src-tauri"
    cargo build
    echo "✓ 完成: target/debug/nine-rings"
    ;;
  release)
    echo "▸ release 编译 nine-rings (desktop)..."
    cd "$(dirname "$0")/src-tauri"
    cargo build --release
    echo "✓ 完成: target/release/nine-rings"
    ;;
  web)
    echo "▸ 构建 Web 版..."
    cd "$(dirname "$0")"
    npm run build
    echo "✓ 完成: dist/"
    echo "  启动: cd dist && python3 -m http.server 8080"
    ;;
  clean)
    echo "▸ 清理..."
    cd "$(dirname "$0")"
    rm -rf src-tauri/target dist
    echo "✓ 已清理"
    ;;
  *)
    echo "用法: $0 [dev|release|web|clean]"
    exit 1
    ;;
esac

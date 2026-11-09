#!/usr/bin/env bash
set -euo pipefail

build_script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/build-tauri-with-retry.sh"
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT
mkdir -p "$test_dir/bin"
cat > "$test_dir/bin/npx" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
[[ "$*" == "tauri build --target x86_64-unknown-linux-gnu --bundles deb,appimage -- --locked" ]] || exit 99
count=$(cat "$NR_CI_TEST_COUNTER")
count=$((count + 1))
echo "$count" > "$NR_CI_TEST_COUNTER"
case "$NR_CI_TEST_CASE" in
  success) exit 0 ;;
  recover)
    if (( count == 3 )); then exit 0; fi
    printf 'failed to bundle project: `http status: %s`\n' "$((count == 1 ? 502 : 504))"
    exit 7 ;;
  fatal_after_network)
    if (( count == 1 )); then echo 'failed to bundle project: `http status: 504`'; exit 7; fi
    echo 'error[E0308]: mismatched types'; exit 42 ;;
  exhausted) echo 'failed to bundle project: `http status: 503`'; exit 9 ;;
  compiler) echo 'error[E0308]: mismatched types'; exit 42 ;;
  denied) echo 'failed to bundle project: `http status: 403`'; exit 8 ;;
esac
exit 98
MOCK
chmod +x "$test_dir/bin/npx"

check() {
  local scenario=$1 expected_status=$2 expected_count=$3 delay=${4:-0} actual_status=0
  echo 0 > "$test_dir/count"
  PATH="$test_dir/bin:$PATH" NR_CI_TEST_CASE="$scenario" NR_CI_TEST_COUNTER="$test_dir/count" NR_TAURI_RETRY_DELAY="$delay" \
    bash "$build_script" --target x86_64-unknown-linux-gnu --bundles deb,appimage -- --locked > "$test_dir/output" 2>&1 || actual_status=$?
  if [[ "$actual_status" != "$expected_status" || "$(cat "$test_dir/count")" != "$expected_count" ]]; then
    cat "$test_dir/output" >&2
    echo "FAILED: $scenario (status=$actual_status)" >&2
    exit 1
  fi
  echo "PASS: $scenario ($expected_count invocation(s), exit $expected_status)"
}

check success 0 1
check recover 0 3
check exhausted 9 3
check compiler 42 1
check denied 8 1
check fatal_after_network 42 2
check invalid-delay 2 0 invalid
check excessive-delay 2 0 61

#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

rust_driver="src/compiler_rust/target/debug/simple"

if [ ! -x "$rust_driver" ]; then
    echo "building Rust driver..." >&2
    cargo build --manifest-path src/compiler_rust/Cargo.toml -p simple-driver --bin simple >&2
fi

echo "checking new 2D engine demo with Rust driver..." >&2

runner=("$rust_driver")
if [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ] && command -v xvfb-run >/dev/null 2>&1; then
    echo "headless shell detected, using xvfb-run for the demo window..." >&2
    runner=(xvfb-run -a "$rust_driver")
fi

set +e
"${runner[@]}" examples/engine_2d_demo/main.spl "$@"
status=$?
set -e

if [ "$status" -eq 0 ]; then
    exit 0
fi

echo "error: the new 2D engine demo is still not runnable end-to-end in this checkout." >&2
echo "current blockers:" >&2
if [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ] && ! command -v xvfb-run >/dev/null 2>&1; then
    echo "  1. no DISPLAY/WAYLAND_DISPLAY is available, and xvfb-run is not installed" >&2
    echo "  2. self-hosted bin/simple_native still segfaults in generic run/check paths" >&2
else
    echo "  1. self-hosted bin/simple_native still segfaults in generic run/check paths" >&2
fi
echo "the Rust driver now has interpreter-backed rt_winit_* and rt_rapier2d_* support." >&2
exit "$status"

#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION=""
OUT_DIR="${ROOT}/release"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      VERSION="$2"
      shift 2
      ;;
    --output-dir)
      OUT_DIR="$2"
      shift 2
      ;;
    *)
      echo "unknown arg: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "${VERSION}" ]]; then
  echo "--version is required" >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required for local publishing" >&2
  exit 1
fi

"${ROOT}/scripts/release/package-obsidian-search-bundles.sh" --version "${VERSION}" --output-dir "${OUT_DIR}"

echo "Local publish is intentionally manual."
echo "Upload the generated native bundle with:"
echo "  gh release upload v${VERSION} ${OUT_DIR}/obsidian-search-bundle-${VERSION}.tar.gz"

#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME=""
OUT_DIR="${ROOT}/release"
VERSION=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-dir)
      OUT_DIR="$2"
      shift 2
      ;;
    --version)
      VERSION="$2"
      shift 2
      ;;
    --runtime)
      RUNTIME="$2"
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

if [[ -z "${RUNTIME}" ]]; then
  if [[ -x "${ROOT}/bin/release/simple" ]]; then
    RUNTIME="${ROOT}/bin/release/simple"
  else
    RUNTIME="${ROOT}/../../bin/release/simple"
  fi
fi

if [[ ! -x "${RUNTIME}" ]]; then
  echo "runtime not found: ${RUNTIME}" >&2
  exit 1
fi

mkdir -p "${OUT_DIR}"
STAGE="$(mktemp -d)"
trap 'rm -rf "${STAGE}"' EXIT

DIR="${STAGE}/obsidian-search-bundle"
mkdir -p "${DIR}/bin" "${DIR}/lib"
cp "${RUNTIME}" "${DIR}/bin/simple"
"${RUNTIME}" compile "${ROOT}/src/main.spl" -o "${DIR}/lib/obsidian-search.smf"
cat > "${DIR}/bin/obsidian-search-server" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "${HERE}/simple" "${HERE}/../lib/obsidian-search.smf" "$@"
EOF
chmod +x "${DIR}/bin/obsidian-search-server"
cat > "${DIR}/README.md" <<'EOF'
# obsidian-search bundle

Self-contained MCP bundle for Obsidian vault search.

Default command:

```bash
OBSIDIAN_VAULT_PATH=/path/to/vault ./bin/obsidian-search-server
```
EOF

tar -czf "${OUT_DIR}/obsidian-search-bundle-${VERSION}.tar.gz" -C "${STAGE}" obsidian-search-bundle
echo "Packaged obsidian-search bundle into ${OUT_DIR}"

#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
cp -R "$root/data" "$tmp/data"; mkdir -p "$tmp/data/project_proofs"
cat > "$tmp/data/project_proofs/simple.sdn" <<'EOF'
project=simple
repository=https://github.com/ormastes/simple
branch=main
commit=62eada434c050cb688598bef1ab4f5a25b5cb404
simple_tag=v1.0.1-beta.1
simple_commit=62eada434c050cb688598bef1ab4f5a25b5cb404
tree=clean
test_result=verified
test_command=simple test test/03_system/project_proof
checked_at=2026-09-07T00:00:00Z
follow_up=none
EOF
work=$(mktemp -d); trap 'rm -rf "$tmp" "$work"' EXIT
cp -R "$root/scripts" "$work/"
mkdir -p "$work/docs"
cp "$root/docs/glass.css" "$work/docs/"
mv "$tmp/data" "$work/data"
sh "$work/scripts/project_proof.sh" >/dev/null
grep -q 'st-verified' "$work/docs/projects.html"
sed -i 's/tree=clean/tree=dirty/' "$work/data/project_proofs/simple.sdn"
if sh "$work/scripts/project_proof.sh" >/dev/null 2>&1; then echo 'expected dirty receipt rejection' >&2; exit 1; fi
grep -q 'st-failed' "$work/docs/projects.html"
echo 'PASS: project provenance simulator states verified and dirty-rejected'

#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
cp -R "$root/data" "$tmp/data"; mkdir -p "$tmp/data/project_proofs"
cat > "$tmp/data/project_proofs/simple.sdn" <<'EOF'
schema=project-proof-v1
project=simple
repository=https://github.com/ormastes/simple
branch=main
commit=62eada434c050cb688598bef1ab4f5a25b5cb404
simple_tag=v1.0.1-beta.1
simple_commit=62eada434c050cb688598bef1ab4f5a25b5cb404
tree=clean
test_result=verified
test_command=simple test test/03_system/project_proof
test_exit=0
test_output_sha256=0f5c408234c85a2ca5db0ef87b9ddcd7d5907e2cf1cec9fa7d9ca35e2dbaaaa1
sspec_paths=test/03_system/project_proof/project_provenance_showcase_spec.spl
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
sed -i 's/tree=dirty/tree=clean/' "$work/data/project_proofs/simple.sdn"
printf '%s\n' 'tree=clean' >> "$work/data/project_proofs/simple.sdn"
if sh "$work/scripts/project_proof.sh" >/dev/null 2>&1; then echo 'expected duplicate-key rejection' >&2; exit 1; fi
grep -q 'invalid receipt' "$work/docs/projects.html"
sed -i '$d' "$work/data/project_proofs/simple.sdn"
sed -i 's#test_command=.*#test_command=<script>#' "$work/data/project_proofs/simple.sdn"
if sh "$work/scripts/project_proof.sh" >/dev/null 2>&1; then echo 'expected unsafe-field rejection' >&2; exit 1; fi
echo 'PASS: project provenance simulator rejects dirty, duplicate, and unsafe receipts'

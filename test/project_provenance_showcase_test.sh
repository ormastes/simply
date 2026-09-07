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
simple_binary_sha256=1111111111111111111111111111111111111111111111111111111111111111
simple_version_sha256=2222222222222222222222222222222222222222222222222222222222222222
tree=clean
test_result=verified
failure_phase=none
test_command=simple test test/03_system/project_proof
test_exit=0
test_output_sha256=0f5c408234c85a2ca5db0ef87b9ddcd7d5907e2cf1cec9fa7d9ca35e2dbaaaa1
sspec_paths=test/03_system/project_proof/project_provenance_showcase_spec.spl
sspec_review=basic-static
checked_at=2026-09-07T00:00:00Z
follow_up=manual-semantic-review
EOF
work=$(mktemp -d); trap 'rm -rf "$tmp" "$work"' EXIT
cp -R "$root/scripts" "$work/"
mkdir -p "$work/docs"
cp "$root/docs/glass.css" "$work/docs/"
mv "$tmp/data" "$work/data"
proof="$work/data/project_proofs/simple.sdn"; valid="$work/valid.sdn"; cp "$proof" "$valid"
reject() {
  if sh "$work/scripts/project_proof.sh" >/dev/null 2>&1; then echo "expected $1 rejection" >&2; exit 1; fi
  grep -q 'st-failed' "$work/docs/projects.html"
}

sh "$work/scripts/project_proof.sh" >/dev/null
grep -q 'simple.*st-verified' "$work/docs/projects.html"

mv "$proof" "$proof.absent"
sh "$work/scripts/project_proof.sh" >/dev/null
grep -q 'simple.*st-unverified' "$work/docs/projects.html"
mv "$proof.absent" "$proof"

cp "$valid" "$proof"; sed -i 's/test_result=verified/test_result=failed/; s/failure_phase=none/failure_phase=project-test/; s/test_exit=0/test_exit=7/' "$proof"
sh "$work/scripts/project_proof.sh" >/dev/null
grep -q 'simple.*st-failed' "$work/docs/projects.html"

cp "$valid" "$proof"; sed -i 's/tree=clean/tree=dirty/' "$proof"; reject dirty
cp "$valid" "$proof"; sed -i '/^schema=/d' "$proof"; reject malformed
cp "$valid" "$proof"; sed -i 's/simple_commit=./simple_commit=f/' "$proof"; reject beta-mismatch
cp "$valid" "$proof"; printf '%s\n' 'tree=clean' >> "$proof"; reject duplicate-key
cp "$valid" "$proof"; sed -i 's#test_command=.*#test_command=<script>#' "$proof"; reject unsafe-field
cp "$valid" "$proof"; printf '%s\n' 'project_tag=v1.0.0' 'project_tag_commit=1111111111111111111111111111111111111111' >> "$proof"; reject tag-mismatch
cp "$valid" "$proof"; printf '%s\n' 'project_tag=v1.0.1-beta.1' 'project_tag_commit=62eada434c050cb688598bef1ab4f5a25b5cb404' >> "$proof"
sh "$work/scripts/project_proof.sh" >/dev/null
grep -q 'tag v1.0.1-beta.1' "$work/docs/projects.html"

echo 'PASS: simulator covers verified, failed, absent, malformed, dirty, unsafe, duplicate, beta-mismatch, and project-tag states'

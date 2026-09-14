#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
export PROOF_NOW=2026-09-07T12:00:00Z
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
valid_until=2026-09-08T00:00:00Z
follow_up=manual-semantic-review
EOF
work=$(mktemp -d); trap 'rm -rf "$tmp" "$work"' EXIT
cp -R "$root/scripts" "$work/"
mkdir -p "$work/docs"
cp "$root/docs/glass.css" "$work/docs/"
mv "$tmp/data" "$work/data"
proof="$work/data/project_proofs/simple.sdn"; valid="$work/valid.sdn"; cp "$proof" "$valid"
reject() {
  set +e; sh "$work/scripts/project_proof.sh" >/dev/null 2>&1; status=$?; set -e
  [ "$status" -eq 3 ] || { echo "expected $1 evidence rejection status 3, got $status" >&2; exit 1; }
  grep -q 'st-failed' "$work/docs/projects.html"
}

sh "$work/scripts/project_proof.sh" >/dev/null
grep -q 'simple.*st-verified' "$work/docs/projects.html"

mv "$proof" "$proof.absent"
sh "$work/scripts/project_proof.sh" >/dev/null
grep -q 'simple.*st-unverified' "$work/docs/projects.html"
grep -q 'observed, not proof' "$work/docs/projects.html"
grep -q 'private revision withheld' "$work/docs/projects.html"
mv "$proof.absent" "$proof"

cp "$valid" "$proof"; sed -i 's/test_result=verified/test_result=failed/; s/failure_phase=none/failure_phase=project-test/; s/test_exit=0/test_exit=7/' "$proof"
sh "$work/scripts/project_proof.sh" >/dev/null
grep -q 'simple.*st-failed' "$work/docs/projects.html"

cp "$valid" "$proof"; sed -i 's/tree=clean/tree=dirty/' "$proof"; reject dirty
cp "$valid" "$proof"; sed -i '/^schema=/d' "$proof"; reject malformed
cp "$valid" "$proof"; sed -i 's/simple_commit=./simple_commit=f/' "$proof"; reject beta-mismatch
cp "$valid" "$proof"; printf '%s\n' 'tree=clean' >> "$proof"; reject duplicate-key
cp "$valid" "$proof"; sed -i 's#test_command=.*#test_command=<script>#' "$proof"; reject unsafe-field
cp "$valid" "$proof"; sed -i 's/valid_until=.*/valid_until=2026-09-06T00:00:00Z/' "$proof"; reject expired
cp "$valid" "$proof"; sed -i 's/valid_until=.*/valid_until=2026-09-07T12:00:00Z/' "$proof"; reject boundary
cp "$valid" "$proof"; sed -i 's/valid_until=.*/valid_until=2026-02-30T00:00:00Z/' "$proof"; reject malformed-expiry
cp "$valid" "$proof"; sed -i 's/checked_at=.*/checked_at=2026-09-08T00:00:00Z/' "$proof"; reject future-check
cp "$valid" "$proof.real"; rm "$proof"; ln -s "$proof.real" "$proof"; reject symlink; rm "$proof"; mv "$proof.real" "$proof"
cp "$valid" "$proof"; printf '%s\n' 'project_tag=v1.0.0' 'project_tag_commit=1111111111111111111111111111111111111111' >> "$proof"; reject tag-mismatch
cp "$valid" "$proof"; printf '%s\n' 'project_tag=v1.0.1-beta.1' 'project_tag_commit=62eada434c050cb688598bef1ab4f5a25b5cb404' >> "$proof"
sh "$work/scripts/project_proof.sh" >/dev/null
grep -q 'tag v1.0.1-beta.1' "$work/docs/projects.html"

cp "$work/data/project_observations.sdn" "$work/observations.valid"
duplicate_observation=$(grep '^simple|' "$work/data/project_observations.sdn")
printf '%s\n' "$duplicate_observation" >> "$work/data/project_observations.sdn"
set +e; sh "$work/scripts/project_proof.sh" >/dev/null 2>&1; status=$?; set -e
[ "$status" -eq 1 ] || { echo "expected structural observation failure status 1, got $status" >&2; exit 1; }
grep -q 'st-failed' "$work/docs/projects.html"
mv "$work/observations.valid" "$work/data/project_observations.sdn"

echo 'PASS: simulator covers proof states, immutable observations, private metadata, and malformed evidence'

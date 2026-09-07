#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
project="$tmp/project"; mkdir -p "$project/test/system"
mkdir -p "$tmp/bin"
cat > "$tmp/bin/simple" <<'EOF'
#!/bin/sh
if [ "${1:-}" = --version ]; then echo 'Simple test runtime'; else printf 'proof-ok'; fi
EOF
chmod +x "$tmp/bin/simple"
PATH="$tmp/bin:$PATH"; export PATH
git -C "$project" init -q -b main
git -C "$project" config user.name proof-test
git -C "$project" config user.email proof@example.invalid
git -C "$project" remote add origin https://github.com/ormastes/simple
cat > "$project/test/system/proof_spec.spl" <<'EOF'
use std.spec.*
describe "proof":
    it "checks behavior":
        expect("working").to_equal("working")
EOF
git -C "$project" add test/system/proof_spec.spl
git -C "$project" commit -qm initial
git -C "$project" tag proof-v1
receipt="$tmp/receipt.sdn"

sh "$root/scripts/collect_project_proof.sh" simple "$project" test/system/proof_spec.spl --tag proof-v1 --output "$receipt" --log "$tmp/proof.log" -- simple test test/system/proof_spec.spl >/dev/null
grep -q '^test_result=verified$' "$receipt"
grep -Eq '^test_output_sha256=[0-9a-f]{64}$' "$receipt"
grep -q '^sspec_review=basic-static$' "$receipt"
grep -Eq '^simple_binary_sha256=[0-9a-f]{64}$' "$receipt"
grep -Eq '^simple_version_sha256=[0-9a-f]{64}$' "$receipt"
grep -q '^follow_up=manual-semantic-review$' "$receipt"
digest=$(sed -n 's/^test_output_sha256=//p' "$receipt")
if command -v sha256sum >/dev/null 2>&1; then actual=$(sha256sum "$tmp/proof.log" | awk '{print $1}'); else actual=$(shasum -a 256 "$tmp/proof.log" | awk '{print $1}'); fi
[ "$digest" = "$actual" ]

cat > "$tmp/bin/simple" <<'EOF'
#!/bin/sh
if [ "${1:-}" = --version ]; then echo 'Simple test runtime'; else exit 1; fi
EOF
if sh "$root/scripts/collect_project_proof.sh" simple "$project" test/system/proof_spec.spl --output "$receipt" -- simple test test/system/proof_spec.spl >/dev/null 2>&1; then echo 'expected failing command status' >&2; exit 1; fi
grep -q '^test_result=failed$' "$receipt"
grep -q '^test_exit=1$' "$receipt"

printf '%s\n' dirty > "$project/untracked"
if sh "$root/scripts/collect_project_proof.sh" simple "$project" test/system/proof_spec.spl --output "$tmp/dirty.sdn" -- simple test test/system/proof_spec.spl >/dev/null 2>&1; then echo 'expected dirty checkout rejection' >&2; exit 1; fi
[ ! -e "$tmp/dirty.sdn" ]
rm "$project/untracked"
sed -i 's/expect("working").to_equal("working")/expect(true).to_equal(true)/' "$project/test/system/proof_spec.spl"
git -C "$project" add test/system/proof_spec.spl; git -C "$project" commit -qm placeholder
if sh "$root/scripts/collect_project_proof.sh" simple "$project" test/system/proof_spec.spl --output "$tmp/placeholder.sdn" -- simple test test/system/proof_spec.spl >/dev/null 2>&1; then echo 'expected placeholder SSpec rejection' >&2; exit 1; fi

echo 'PASS: collector binds identity, tag, SSpec review, result, digest, and clean tree'

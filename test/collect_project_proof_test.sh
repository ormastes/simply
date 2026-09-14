#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
fixture="$tmp/harness"; mkdir -p "$fixture/scripts" "$fixture/data"
cp "$root/scripts/collect_project_proof.sh" "$fixture/scripts/"
printf '%s\n' 'simple|https://github.com/ormastes/simple|main|compiler' > "$fixture/data/projects.sdn"

simple_checkout="$tmp/simple"; mkdir -p "$simple_checkout/bin"
cat > "$simple_checkout/bin/simple_native" <<'EOF'
#!/bin/sh
if [ "${1:-}" = --version ]; then
  [ "${SIMPLE_TEST_MODE:-}" = preflight-fail ] && exit 139
  [ "${SIMPLE_TEST_MODE:-}" = seed ] && { echo 'Rust-built Simple binary is a bootstrap seed only'; exit 0; }
  echo 'Simple production test runtime'
elif [ "${PROOF_MUTATE_HEAD:-0}" = 1 ]; then
  git -C "$SIMPLE_PROOF_PROJECT" commit --allow-empty -qm mutation
elif [ "${SIMPLE_TEST_MODE:-}" = project-fail ]; then
  exit 1
elif [ "${SIMPLE_TEST_MODE:-}" = mutate-simple ]; then
  git -C "$SIMPLE_PROOF_SIMPLE" commit --allow-empty -qm mutation
else
  printf 'proof-ok'
fi
EOF
chmod +x "$simple_checkout/bin/simple_native"
git -C "$simple_checkout" init -q
git -C "$simple_checkout" config user.name proof-test
git -C "$simple_checkout" config user.email proof@example.invalid
git -C "$simple_checkout" remote add origin https://github.com/ormastes/simple
git -C "$simple_checkout" add bin/simple_native
git -C "$simple_checkout" commit -qm release
git -C "$simple_checkout" tag v1.0.1-beta.1
simple_commit=$(git -C "$simple_checkout" rev-parse HEAD)
cat > "$fixture/data/simple_release.sdn" <<EOF
repository=https://github.com/ormastes/simple
tag=v1.0.1-beta.1
commit=$simple_commit
EOF

project="$tmp/project"; mkdir -p "$project/test/system"
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
git -C "$project" add .; git -C "$project" commit -qm initial; git -C "$project" tag proof-v1

collector="$fixture/scripts/collect_project_proof.sh"
receipt="$tmp/receipt.sdn"; valid_until=2999-12-31T23:59:59Z
collect() { sh "$collector" simple "$project" test/system/proof_spec.spl --simple-checkout "$simple_checkout" --valid-until "$valid_until" "$@" -- simple test test/system/proof_spec.spl; }

collect --tag proof-v1 --output "$receipt" --log "$tmp/proof.log" >/dev/null
grep -q '^test_result=verified$' "$receipt"
grep -q '^valid_until=2999-12-31T23:59:59Z$' "$receipt"
grep -Eq '^test_output_sha256=[0-9a-f]{64}$' "$receipt"
grep -Eq '^simple_binary_sha256=[0-9a-f]{64}$' "$receipt"

if SIMPLE_TEST_MODE=project-fail collect --output "$receipt" >/dev/null 2>&1; then echo 'expected failing command status' >&2; exit 1; fi
grep -q '^failure_phase=project-test$' "$receipt"
if SIMPLE_TEST_MODE=preflight-fail collect --output "$receipt" >/dev/null 2>&1; then echo 'expected preflight failure' >&2; exit 1; fi
grep -q '^test_exit=139$' "$receipt"; grep -q '^failure_phase=simple-version$' "$receipt"
if SIMPLE_TEST_MODE=seed collect --output "$tmp/seed.sdn" >/dev/null 2>&1; then echo 'expected seed identity rejection' >&2; exit 1; fi
[ ! -e "$tmp/seed.sdn" ]

printf dirty > "$project/untracked"
if collect --output "$tmp/dirty.sdn" >/dev/null 2>&1; then echo 'expected dirty rejection' >&2; exit 1; fi
[ ! -e "$tmp/dirty.sdn" ]; rm "$project/untracked"
sed -i 's/expect("working").to_equal("working")/expect(true).to_equal(true)/' "$project/test/system/proof_spec.spl"
git -C "$project" add .; git -C "$project" commit -qm placeholder
if collect --output "$tmp/placeholder.sdn" >/dev/null 2>&1; then echo 'expected placeholder SSpec rejection' >&2; exit 1; fi
sed -i 's/expect(true).to_equal(true)/expect("working").to_equal("working")/' "$project/test/system/proof_spec.spl"
git -C "$project" add .; git -C "$project" commit -qm restored-spec
if collect --output "$project/receipt.sdn" >/dev/null 2>&1; then echo 'expected output containment rejection' >&2; exit 1; fi
if collect --log "$project/test.log" >/dev/null 2>&1; then echo 'expected log containment rejection' >&2; exit 1; fi

git -C "$simple_checkout" remote set-url origin https://github.com/ormastes/not-simple
if collect --output "$tmp/wrong-origin.sdn" >/dev/null 2>&1; then echo 'expected wrong origin rejection' >&2; exit 1; fi
git -C "$simple_checkout" remote set-url origin https://github.com/ormastes/simple

printf dirty > "$simple_checkout/untracked"
if collect --output "$tmp/dirty-simple.sdn" >/dev/null 2>&1; then echo 'expected dirty Simple checkout rejection' >&2; exit 1; fi
rm "$simple_checkout/untracked"

sed -i "s/commit=.*/commit=0000000000000000000000000000000000000000/" "$fixture/data/simple_release.sdn"
if collect --output "$tmp/wrong-head.sdn" >/dev/null 2>&1; then echo 'expected pinned HEAD rejection' >&2; exit 1; fi
sed -i "s/commit=.*/commit=$simple_commit/" "$fixture/data/simple_release.sdn"

git -C "$simple_checkout" show HEAD:bin/simple_native > "$tmp/simple-native"
printf '\n# tampered\n' >> "$simple_checkout/bin/simple_native"
git -C "$simple_checkout" update-index --assume-unchanged bin/simple_native
if collect --output "$tmp/tampered-binary.sdn" >/dev/null 2>&1; then echo 'expected binary object rejection' >&2; exit 1; fi
git -C "$simple_checkout" update-index --no-assume-unchanged bin/simple_native
cp "$tmp/simple-native" "$simple_checkout/bin/simple_native"; chmod +x "$simple_checkout/bin/simple_native"

git -C "$simple_checkout" commit --allow-empty -qm second-release
second_commit=$(git -C "$simple_checkout" rev-parse HEAD)
sed -i "s/commit=.*/commit=$second_commit/" "$fixture/data/simple_release.sdn"
if collect --output "$tmp/wrong-tag.sdn" >/dev/null 2>&1; then echo 'expected pinned tag rejection' >&2; exit 1; fi
git -C "$simple_checkout" reset --hard -q "$simple_commit"
sed -i "s/commit=.*/commit=$simple_commit/" "$fixture/data/simple_release.sdn"

if SIMPLE_PROOF_SIMPLE="$simple_checkout" SIMPLE_TEST_MODE=mutate-simple collect --output "$tmp/simple-change.sdn" >/dev/null 2>&1; then echo 'expected Simple mutation rejection' >&2; exit 1; fi
[ ! -e "$tmp/simple-change.sdn" ]; git -C "$simple_checkout" reset --hard -q "$simple_commit"

if SIMPLE_PROOF_PROJECT="$project" PROOF_MUTATE_HEAD=1 collect --output "$tmp/head-change.sdn" >/dev/null 2>&1; then echo 'expected HEAD mutation rejection' >&2; exit 1; fi
[ ! -e "$tmp/head-change.sdn" ]

echo 'PASS: collector binds trusted runtime, immutable identity, validity, output safety, and clean tree'

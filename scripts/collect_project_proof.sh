#!/bin/sh
# Maintenance-time verifier. It never clones and never trusts caller-supplied
# repository identity; all identity comes from the tracked project catalog and
# the immutable Simple release record.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd -P)
usage() { echo "usage: $0 <project-id> <checkout> <sspec-path[,path...]> --simple-checkout <checkout> --valid-until <UTC> [--tag <tag>] [--output <receipt>] [--log <test-log>] -- <command> [args...]" >&2; exit 2; }
[ "$#" -ge 7 ] || usage
id=$1; checkout=$2; specs=$3; shift 3
project_tag=; output="$root/data/project_proofs/$id.sdn"; log_output=; simple_checkout=; valid_until=
while [ "$#" -gt 0 ] && [ "$1" != -- ]; do
  case "$1" in
    --simple-checkout) [ "$#" -ge 2 ] || usage; [ -z "$simple_checkout" ] || usage; simple_checkout=$2; shift 2;;
    --valid-until) [ "$#" -ge 2 ] || usage; [ -z "$valid_until" ] || usage; valid_until=$2; shift 2;;
    --tag) [ "$#" -ge 2 ] || usage; project_tag=$2; shift 2;;
    --output) [ "$#" -ge 2 ] || usage; output=$2; shift 2;;
    --log) [ "$#" -ge 2 ] || usage; log_output=$2; shift 2;;
    *) usage;;
  esac
done
[ -n "$simple_checkout" ] || { echo "FAIL: --simple-checkout is required" >&2; exit 2; }
[ -n "$valid_until" ] || { echo "FAIL: --valid-until is required" >&2; exit 2; }
printf '%s' "$valid_until" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$' || { echo "FAIL: invalid validity deadline" >&2; exit 2; }
[ "${1:-}" = -- ] || usage; shift; [ "$#" -gt 0 ] || usage

line=$(awk -F'|' -v id="$id" '$1 == id { print }' "$root/data/projects.sdn")
[ "$(printf '%s\n' "$line" | grep -c .)" -eq 1 ] || { echo "FAIL: project id is absent or duplicated: $id" >&2; exit 2; }
IFS='|' read -r catalog_id repository branch capabilities <<EOF
$line
EOF

release="$root/data/simple_release.sdn"
simple_repository=$(sed -n 's/^repository=//p' "$release")
simple_tag=$(sed -n 's/^tag=//p' "$release")
simple_commit=$(sed -n 's/^commit=//p' "$release")
[ "$(grep -c '^repository=' "$release")" -eq 1 ] && [ "$(grep -c '^tag=' "$release")" -eq 1 ] && [ "$(grep -c '^commit=' "$release")" -eq 1 ] && [ "$simple_repository" = https://github.com/ormastes/simple ] && [ "$simple_tag" = v1.0.1-beta.1 ] && printf '%s' "$simple_commit" | grep -Eq '^[0-9a-f]{40}$' || { echo "FAIL: invalid pinned Simple release" >&2; exit 2; }

normalize_origin() { printf '%s' "$1" | sed 's/\.git$//'; }
canonical_path() {
  candidate=$1
  case "$candidate" in /*) ;; *) candidate="$PWD/$candidate";; esac
  if command -v realpath >/dev/null 2>&1; then
    resolved=$(realpath -m -- "$candidate" 2>/dev/null || true)
    [ -n "$resolved" ] && { printf '%s\n' "$resolved"; return 0; }
  fi
  parent=$(dirname -- "$candidate"); name=$(basename -- "$candidate")
  [ -d "$parent" ] || return 1
  printf '%s/%s\n' "$(CDPATH= cd -- "$parent" && pwd -P)" "$name"
}
project_root=$(canonical_path "$checkout") || { echo "FAIL: project checkout cannot be resolved" >&2; exit 2; }
simple_root=$(canonical_path "$simple_checkout") || { echo "FAIL: Simple checkout cannot be resolved" >&2; exit 2; }
[ "$project_root" != "$simple_root" ] || { echo "FAIL: project and Simple checkouts must be distinct" >&2; exit 2; }

reject_checkout_output() {
  path=$1; label=$2
  resolved=$(canonical_path "$path" 2>/dev/null || true)
  [ -n "$resolved" ] || { echo "FAIL: $label path parent cannot be resolved: $path" >&2; exit 2; }
  case "$resolved" in
    "$project_root"|"$project_root"/*|"$simple_root"|"$simple_root"/*)
      echo "FAIL: $label path must be outside both checkouts: $path" >&2; exit 2;;
  esac
}
reject_checkout_output "$output" receipt
[ -z "$log_output" ] || reject_checkout_output "$log_output" log
[ -z "$log_output" ] || [ "$(canonical_path "$output")" != "$(canonical_path "$log_output")" ] || { echo "FAIL: receipt and log paths must differ" >&2; exit 2; }
git_value() { git_checkout=$1; shift; git -C "$git_checkout" "$@" 2>/dev/null || true; }
assert_project_state() {
  [ "$(git_value "$project_root" rev-parse --is-inside-work-tree)" = true ] || return 1
  [ "$(normalize_origin "$(git_value "$project_root" remote get-url origin)")" = "$repository" ] || return 1
  [ "$(git_value "$project_root" symbolic-ref --quiet --short HEAD)" = "$branch" ] || return 1
  [ "$(git_value "$project_root" rev-parse HEAD)" = "$commit" ] || return 1
  [ -z "$(git -C "$project_root" status --porcelain=v1 --untracked-files=all 2>/dev/null || true)" ] || return 1
  if [ -n "$project_tag" ]; then [ "$(git_value "$project_root" rev-parse "$project_tag^{commit}")" = "$tag_commit" ] || return 1; fi
}
assert_simple_state() {
  [ "$(git_value "$simple_root" rev-parse --is-inside-work-tree)" = true ] || return 1
  [ "$(normalize_origin "$(git_value "$simple_root" remote get-url origin)")" = "$simple_repository" ] || return 1
  [ "$(git_value "$simple_root" rev-parse HEAD)" = "$simple_commit" ] || return 1
  [ "$(git_value "$simple_root" rev-parse "$simple_tag^{commit}")" = "$simple_commit" ] || return 1
  [ -z "$(git -C "$simple_root" status --porcelain=v1 --untracked-files=all 2>/dev/null || true)" ] || return 1
}
[ "$(git_value "$project_root" rev-parse --is-inside-work-tree)" = true ] || { echo "FAIL: checkout is not a Git worktree: $checkout" >&2; exit 2; }
actual_repo=$(normalize_origin "$(git_value "$project_root" remote get-url origin)")
[ "$actual_repo" = "$repository" ] || { echo "FAIL: origin is not canonical catalog URL" >&2; exit 2; }
actual_branch=$(git_value "$project_root" symbolic-ref --quiet --short HEAD)
[ "$actual_branch" = "$branch" ] || { echo "FAIL: expected branch $branch, found ${actual_branch:-detached}" >&2; exit 2; }
[ -z "$(git -C "$project_root" status --porcelain=v1 --untracked-files=all)" ] || { echo "FAIL: project checkout is dirty before proof" >&2; exit 1; }
commit=$(git -C "$project_root" rev-parse HEAD); printf '%s' "$commit" | grep -Eq '^[0-9a-f]{40}$' || exit 2

tag_commit=
if [ -n "$project_tag" ]; then
  case "$project_tag" in -*|*[!A-Za-z0-9._/-]*) echo "FAIL: unsafe project tag" >&2; exit 2;; esac
  tag_commit=$(git -C "$project_root" rev-parse "$project_tag^{commit}" 2>/dev/null || true)
  [ "$tag_commit" = "$commit" ] || { echo "FAIL: project tag does not resolve to HEAD" >&2; exit 2; }
fi

assert_simple_state || { echo "FAIL: Simple checkout is not the canonical clean pinned release" >&2; exit 2; }
simple_binary="$simple_root/bin/simple_native"
simple_binary_real=$(canonical_path "$simple_binary" 2>/dev/null || true)
[ -f "$simple_binary" ] && [ -x "$simple_binary" ] && [ -n "$simple_binary_real" ] || { echo "FAIL: production Simple executable is unavailable: $simple_binary" >&2; exit 2; }
case "$simple_binary $simple_binary_real" in
  *src/compiler_rust/*|*/target/bootstrap/*|*/stage3/*|*/debug/*|*simple_seed*)
    echo "FAIL: production Simple executable resolves to a forbidden seed/debug path" >&2; exit 2;;
esac
case "$simple_binary_real" in "$simple_root"|"$simple_root"/*) ;; *) echo "FAIL: production Simple executable escapes the trusted checkout" >&2; exit 2;; esac
recorded_binary_oid=$(git_value "$simple_root" rev-parse "$simple_commit:bin/simple_native")
actual_binary_oid=$(git_value "$simple_root" hash-object "$simple_binary")
[ -n "$recorded_binary_oid" ] && [ "$actual_binary_oid" = "$recorded_binary_oid" ] || { echo "FAIL: production Simple executable differs from the pinned commit" >&2; exit 2; }

old_ifs=$IFS; IFS=,
for spec in $specs; do
  case "$spec" in test/*_spec.spl) ;; *) echo "FAIL: invalid SSpec path: $spec" >&2; exit 2;; esac
  case "$spec" in *"/../"*|*"//"*) echo "FAIL: unsafe SSpec path: $spec" >&2; exit 2;; esac
  [ -f "$project_root/$spec" ] || { echo "FAIL: missing SSpec: $spec" >&2; exit 2; }
  grep -Eq 'expect\(' "$project_root/$spec" || { echo "FAIL: SSpec has no assertion: $spec" >&2; exit 1; }
  if grep -Eq 'pass_todo|expect\(true\)\.to_equal\(true\)|expect\(false\)\.to_equal\(false\)' "$project_root/$spec"; then
    echo "FAIL: placeholder SSpec evidence: $spec" >&2; exit 1
  fi
done
IFS=$old_ifs

for arg in "$@"; do
  printf '%s' "$arg" | grep -Eq '^[[:alnum:]_./:=,@+-]+$' || { echo "FAIL: command argument cannot be represented unambiguously in a receipt" >&2; exit 2; }
done
[ "$1" = simple ] || { echo "FAIL: proof command must invoke the pinned Simple executable as 'simple'" >&2; exit 2; }
command_text=$1
shift
for arg in "$@"; do command_text="$command_text $arg"; done
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
set +e
"$simple_binary" --version >"$tmp/simple-version.log" 2>&1
simple_probe_exit=$?
set -e
if grep -Eq 'bootstrap seed only|Rust-built Simple binary|Rust-built|simple-bootstrap|debug build' "$tmp/simple-version.log"; then
  echo "FAIL: pinned production Simple executable identifies as a seed/debug binary" >&2; exit 2
fi
if command -v sha256sum >/dev/null 2>&1; then simple_binary_digest=$(sha256sum "$simple_binary" | awk '{print $1}'); simple_version_digest=$(sha256sum "$tmp/simple-version.log" | awk '{print $1}'); else simple_binary_digest=$(shasum -a 256 "$simple_binary" | awk '{print $1}'); simple_version_digest=$(shasum -a 256 "$tmp/simple-version.log" | awk '{print $1}'); fi
assert_project_state || { echo "FAIL: project checkout changed during Simple preflight" >&2; exit 1; }
assert_simple_state || { echo "FAIL: Simple checkout changed during preflight" >&2; exit 1; }
failure_phase=none
if [ "$simple_probe_exit" -ne 0 ]; then
  cp "$tmp/simple-version.log" "$tmp/test.log"; test_exit=$simple_probe_exit; failure_phase=simple-version
else
  set +e
  (cd "$project_root" && SIMPLE_PROOF_TAG=$simple_tag SIMPLE_PROOF_COMMIT=$simple_commit "$simple_binary" "$@") >"$tmp/test.log" 2>&1
  test_exit=$?
  set -e
  [ "$test_exit" -eq 0 ] || failure_phase=project-test
fi
assert_project_state || { echo "FAIL: proof command changed the project checkout; receipt not written" >&2; exit 1; }
assert_simple_state || { echo "FAIL: proof command changed the Simple checkout; receipt not written" >&2; exit 1; }
if command -v sha256sum >/dev/null 2>&1; then digest=$(sha256sum "$tmp/test.log" | awk '{print $1}'); else digest=$(shasum -a 256 "$tmp/test.log" | awk '{print $1}'); fi
[ -z "$log_output" ] || { mkdir -p "$(dirname "$log_output")"; cp "$tmp/test.log" "$log_output"; assert_project_state || { echo "FAIL: project checkout changed while writing log" >&2; exit 1; }; assert_simple_state || { echo "FAIL: Simple checkout changed while writing log" >&2; exit 1; }; }
result=failed; [ "$test_exit" -eq 0 ] && result=verified
checked_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
LC_ALL=C [ "$valid_until" \> "$checked_at" ] || { echo "FAIL: validity deadline must be after collection time" >&2; exit 2; }
mkdir -p "$(dirname "$output")"
{
  echo schema=project-proof-v1
  echo project="$catalog_id"
  echo repository="$repository"
  echo branch="$branch"
  echo commit="$commit"
  if [ -n "$project_tag" ]; then echo project_tag="$project_tag"; echo project_tag_commit="$tag_commit"; fi
  echo simple_tag="$simple_tag"
  echo simple_commit="$simple_commit"
  echo simple_binary_sha256="$simple_binary_digest"
  echo simple_version_sha256="$simple_version_digest"
  echo tree=clean
  echo test_result="$result"
  echo failure_phase="$failure_phase"
  echo test_command="$command_text"
  echo test_exit="$test_exit"
  echo test_output_sha256="$digest"
  echo sspec_paths="$specs"
  echo sspec_review=basic-static
  echo "checked_at=$checked_at"
  echo "valid_until=$valid_until"
  if [ "$result" = verified ]; then echo follow_up=manual-semantic-review
  elif [ "$failure_phase" = simple-version ]; then echo follow_up=https://github.com/ormastes/simple/issues/497
  else echo follow_up=repair-test-failure; fi
} > "$tmp/receipt"
mv "$tmp/receipt" "$output"
assert_project_state || { echo "FAIL: project checkout changed while writing receipt" >&2; exit 1; }
assert_simple_state || { echo "FAIL: Simple checkout changed while writing receipt" >&2; exit 1; }
echo "PROOF: project=$id state=$result commit=$commit simple=$simple_tag@$simple_commit receipt=$output"
[ "$test_exit" -eq 0 ]

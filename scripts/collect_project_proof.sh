#!/bin/sh
# Maintenance-time verifier. It never clones and never trusts caller-supplied
# repository identity; all identity comes from the tracked project catalog.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
usage() { echo "usage: $0 <project-id> <checkout> <sspec-path[,path...]> [--tag <tag>] [--output <receipt>] [--log <test-log>] -- <command> [args...]" >&2; exit 2; }
[ "$#" -ge 5 ] || usage
id=$1; checkout=$2; specs=$3; shift 3
project_tag=; output="$root/data/project_proofs/$id.sdn"; log_output=
while [ "$#" -gt 0 ] && [ "$1" != -- ]; do
  case "$1" in
    --tag) [ "$#" -ge 2 ] || usage; project_tag=$2; shift 2;;
    --output) [ "$#" -ge 2 ] || usage; output=$2; shift 2;;
    --log) [ "$#" -ge 2 ] || usage; log_output=$2; shift 2;;
    *) usage;;
  esac
done
[ "${1:-}" = -- ] || usage; shift; [ "$#" -gt 0 ] || usage

line=$(awk -F'|' -v id="$id" '$1 == id { print }' "$root/data/projects.sdn")
[ "$(printf '%s\n' "$line" | grep -c .)" -eq 1 ] || { echo "FAIL: project id is absent or duplicated: $id" >&2; exit 2; }
IFS='|' read -r catalog_id repository branch capabilities <<EOF
$line
EOF
[ "$(git -C "$checkout" rev-parse --is-inside-work-tree 2>/dev/null || true)" = true ] || { echo "FAIL: checkout is not a Git worktree: $checkout" >&2; exit 2; }
actual_repo=$(git -C "$checkout" remote get-url origin 2>/dev/null || true); actual_repo=${actual_repo%.git}
[ "$actual_repo" = "$repository" ] || { echo "FAIL: origin is not canonical catalog URL" >&2; exit 2; }
actual_branch=$(git -C "$checkout" symbolic-ref --quiet --short HEAD 2>/dev/null || true)
[ "$actual_branch" = "$branch" ] || { echo "FAIL: expected branch $branch, found ${actual_branch:-detached}" >&2; exit 2; }
[ -z "$(git -C "$checkout" status --porcelain=v1 --untracked-files=all)" ] || { echo "FAIL: project checkout is dirty before proof" >&2; exit 1; }
commit=$(git -C "$checkout" rev-parse HEAD); printf '%s' "$commit" | grep -Eq '^[0-9a-f]{40}$' || exit 2

tag_commit=
if [ -n "$project_tag" ]; then
  case "$project_tag" in -*|*[!A-Za-z0-9._/-]*) echo "FAIL: unsafe project tag" >&2; exit 2;; esac
  tag_commit=$(git -C "$checkout" rev-parse "$project_tag^{commit}" 2>/dev/null || true)
  [ "$tag_commit" = "$commit" ] || { echo "FAIL: project tag does not resolve to HEAD" >&2; exit 2; }
fi

old_ifs=$IFS; IFS=,
for spec in $specs; do
  case "$spec" in test/*_spec.spl) ;; *) echo "FAIL: invalid SSpec path: $spec" >&2; exit 2;; esac
  case "$spec" in *"/../"*|*"//"*) echo "FAIL: unsafe SSpec path: $spec" >&2; exit 2;; esac
  [ -f "$checkout/$spec" ] || { echo "FAIL: missing SSpec: $spec" >&2; exit 2; }
  grep -Eq 'expect\(' "$checkout/$spec" || { echo "FAIL: SSpec has no assertion: $spec" >&2; exit 1; }
  if grep -Eq 'pass_todo|expect\(true\)\.to_equal\(true\)|expect\(false\)\.to_equal\(false\)' "$checkout/$spec"; then
    echo "FAIL: placeholder SSpec evidence: $spec" >&2; exit 1
  fi
done
IFS=$old_ifs

for arg in "$@"; do
  printf '%s' "$arg" | grep -Eq '^[[:alnum:]_./:=,@+-]+$' || { echo "FAIL: command argument cannot be represented unambiguously in a receipt" >&2; exit 2; }
done
[ "$1" = simple ] || { echo "FAIL: proof command must invoke the pinned Simple executable as 'simple'" >&2; exit 2; }
command_text=$*
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
simple_binary=$(command -v simple 2>/dev/null || true)
[ -n "$simple_binary" ] && [ -x "$simple_binary" ] || { echo "FAIL: pinned Simple executable is unavailable" >&2; exit 2; }
set +e
"$simple_binary" --version >"$tmp/simple-version.log" 2>&1
simple_probe_exit=$?
set -e
if command -v sha256sum >/dev/null 2>&1; then simple_binary_digest=$(sha256sum "$simple_binary" | awk '{print $1}'); simple_version_digest=$(sha256sum "$tmp/simple-version.log" | awk '{print $1}'); else simple_binary_digest=$(shasum -a 256 "$simple_binary" | awk '{print $1}'); simple_version_digest=$(shasum -a 256 "$tmp/simple-version.log" | awk '{print $1}'); fi
simple_tag=$(sed -n 's/^tag=//p' "$root/data/simple_release.sdn"); simple_commit=$(sed -n 's/^commit=//p' "$root/data/simple_release.sdn")
[ "$(grep -c '^tag=' "$root/data/simple_release.sdn")" -eq 1 ] && [ "$(grep -c '^commit=' "$root/data/simple_release.sdn")" -eq 1 ] && [ "$simple_tag" = v1.0.1-beta.1 ] && printf '%s' "$simple_commit" | grep -Eq '^[0-9a-f]{40}$' || { echo "FAIL: invalid pinned Simple release" >&2; exit 2; }
failure_phase=none
if [ "$simple_probe_exit" -ne 0 ]; then
  cp "$tmp/simple-version.log" "$tmp/test.log"; test_exit=$simple_probe_exit; failure_phase=simple-version
else
  set +e
  (cd "$checkout" && SIMPLE_PROOF_TAG=$simple_tag SIMPLE_PROOF_COMMIT=$simple_commit "$@") >"$tmp/test.log" 2>&1
  test_exit=$?
  set -e
  [ "$test_exit" -eq 0 ] || failure_phase=project-test
fi
[ -z "$(git -C "$checkout" status --porcelain=v1 --untracked-files=all)" ] || { echo "FAIL: proof command dirtied the project checkout; receipt not written" >&2; exit 1; }
if command -v sha256sum >/dev/null 2>&1; then digest=$(sha256sum "$tmp/test.log" | awk '{print $1}'); else digest=$(shasum -a 256 "$tmp/test.log" | awk '{print $1}'); fi
[ -z "$log_output" ] || { mkdir -p "$(dirname "$log_output")"; cp "$tmp/test.log" "$log_output"; }
result=failed; [ "$test_exit" -eq 0 ] && result=verified
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
  date -u '+checked_at=%Y-%m-%dT%H:%M:%SZ'
  if [ "$result" = verified ]; then echo follow_up=manual-semantic-review
  elif [ "$failure_phase" = simple-version ]; then echo follow_up=beta-runtime-blocker-ormastes-simple-497
  else echo follow_up=repair-test-failure; fi
} > "$tmp/receipt"
mv "$tmp/receipt" "$output"
echo "PROOF: project=$id state=$result commit=$commit simple=$simple_tag@$simple_commit receipt=$output"
[ "$test_exit" -eq 0 ]

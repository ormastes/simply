#!/bin/sh
# Networked maintenance step. The offline renderer never invokes this script.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
catalog="$root/data/projects.sdn"; current="$root/data/project_observations.sdn"
command -v gh >/dev/null 2>&1 || { echo 'FAIL: gh is required to refresh project observations' >&2; exit 2; }
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

gh repo list ormastes --limit 200 --json name,isPrivate --jq '.[] | select(.isPrivate == false and ((.name | startswith("simple")) or .name == "svllm")) | .name' | sort > "$tmp/live-public"
awk -F'|' '$1 !~ /^#/ && $6 == "public" { print $1 }' "$current" | sort > "$tmp/catalog-public"
if ! diff -u "$tmp/catalog-public" "$tmp/live-public" > "$tmp/catalog.diff"; then
  echo 'FAIL: live public Simple-family repositories differ from the tracked catalog:' >&2
  cat "$tmp/catalog.diff" >&2
  exit 1
fi

observed_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
echo '# id|branch|commit|tag|tag_commit|visibility|observed_at' > "$tmp/observations"
while IFS='|' read -r id repository branch capabilities; do
  case "$id" in ''|'#'*) continue;; esac
  previous=$(awk -F'|' -v id="$id" '$1 == id { print }' "$current")
  [ "$(printf '%s\n' "$previous" | grep -c .)" -eq 1 ] || { echo "FAIL: missing observation row: $id" >&2; exit 1; }
  IFS='|' read -r old_id old_branch old_commit tag old_tag_commit visibility old_observed <<EOF
$previous
EOF
  [ "$old_branch" = "$branch" ] || { echo "FAIL: observation branch drift for $id" >&2; exit 1; }
  if [ "$visibility" = private ]; then
    printf '%s|%s|private|none|none|private|%s\n' "$id" "$branch" "$observed_at" >> "$tmp/observations"
    continue
  fi
  slug=${repository#https://github.com/}
  live_branch=$(gh api "repos/$slug" --jq .default_branch)
  [ "$live_branch" = "$branch" ] || { echo "FAIL: default branch drift for $id: $live_branch" >&2; exit 1; }
  commit=$(gh api "repos/$slug/commits/$branch" --jq .sha)
  printf '%s' "$commit" | grep -Eq '^[0-9a-f]{40}$' || { echo "FAIL: invalid live commit for $id" >&2; exit 1; }
  tag_commit=none
  if [ "$tag" != none ]; then
    tag_commit=$(gh api "repos/$slug/commits/$tag" --jq .sha)
    printf '%s' "$tag_commit" | grep -Eq '^[0-9a-f]{40}$' || { echo "FAIL: invalid tag commit for $id" >&2; exit 1; }
  fi
  printf '%s|%s|%s|%s|%s|public|%s\n' "$id" "$branch" "$commit" "$tag" "$tag_commit" "$observed_at" >> "$tmp/observations"
done < "$catalog"
mv "$tmp/observations" "$current"
echo "PASS: refreshed project observations at $observed_at"

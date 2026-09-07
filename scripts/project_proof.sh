#!/bin/sh
# Offline, fail-closed project-proof verifier and static Projects-page renderer.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
catalog="$root/data/projects.sdn"
receipts="$root/data/project_proofs"
release="$root/data/simple_release.sdn"
output="$root/docs/projects.html"
case "${1:-render}" in render) ;; *) echo "usage: $0 [render]" >&2; exit 2;; esac
field() { sed -n "s/^$2=//p" "$1"; }
# Command substitution discards trailing newlines, so count the source lines
# directly: duplicated keys must invalidate a receipt.
one() { [ "$(grep -c "^$2=" "$1" || true)" -eq 1 ] && field "$1" "$2"; }
safe_text() { printf '%s' "$1" | grep -Eq '^[[:alnum:]_./:=,@+ -]+$'; }
release_tag=$(one "$release" tag); release_commit=$(one "$release" commit)
[ "$release_tag" = v1.0.1-beta.1 ] && printf '%s' "$release_commit" | grep -Eq '^[0-9a-f]{40}$' || exit 2
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
bad=0
{
  printf '%s\n' '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>simply — Project proofs</title><link rel="stylesheet" href="glass.css"></head><body>'
  printf '%s\n' '<header class="hero"><h1>Simple project propagation</h1><p>Immutable, offline proof receipts. Missing or invalid evidence is never a working claim.</p>'
  printf '<p>Compatibility baseline: <a href="https://github.com/ormastes/simple/tree/%s">%s</a> (<code>%s</code>, beta).</p></header>' "$release_tag" "$release_tag" "$release_commit"
  printf '%s\n' '<section class="card"><h2>Advertised projects</h2><div class="tblwrap"><table><tr><th>project</th><th>branch</th><th>project revision</th><th>proof</th><th>SSpec / test</th><th>last known</th><th>follow-up</th></tr>'
  while IFS='|' read -r id repo branch caps; do
    case "$id" in ''|'#'*) continue;; esac
    proof="$receipts/$id.sdn"; state=unverified; commit='—'; command='—'; checked='—'; follow='receipt required'
    if [ -f "$proof" ]; then
      project=$(one "$proof" project 2>/dev/null || true); prepo=$(one "$proof" repository 2>/dev/null || true); pbranch=$(one "$proof" branch 2>/dev/null || true)
      schema=$(one "$proof" schema 2>/dev/null || true); sha=$(one "$proof" commit 2>/dev/null || true); stag=$(one "$proof" simple_tag 2>/dev/null || true); ssha=$(one "$proof" simple_commit 2>/dev/null || true)
      tree=$(one "$proof" tree 2>/dev/null || true); result=$(one "$proof" test_result 2>/dev/null || true); command=$(one "$proof" test_command 2>/dev/null || true); exit_code=$(one "$proof" test_exit 2>/dev/null || true); digest=$(one "$proof" test_output_sha256 2>/dev/null || true); specs=$(one "$proof" sspec_paths 2>/dev/null || true); checked=$(one "$proof" checked_at 2>/dev/null || true); follow=$(one "$proof" follow_up 2>/dev/null || true)
      if [ "$schema" = project-proof-v1 ] && [ "$project" = "$id" ] && [ "$prepo" = "$repo" ] && [ "$pbranch" = "$branch" ] && printf '%s' "$sha" | grep -Eq '^[0-9a-f]{40}$' && [ "$stag" = "$release_tag" ] && [ "$ssha" = "$release_commit" ] && [ "$tree" = clean ] && [ "$result" = verified ] && [ "$exit_code" = 0 ] && printf '%s' "$digest" | grep -Eq '^[0-9a-f]{64}$' && printf '%s' "$specs" | grep -Eq '^test/.+_spec\.spl$' && safe_text "$command" && safe_text "$specs" && safe_text "$checked" && safe_text "$follow"; then
        state=verified; commit="<a href=\"$repo/commit/$sha\"><code>$sha</code></a>"
      else state=failed; bad=1; commit='invalid receipt'; command='—'; checked='—'; follow='repair receipt or test'; fi
    fi
    printf '<tr><td><a href="%s">%s</a><br><small>%s</small></td><td>%s</td><td>%s</td><td><span class="st st-%s">%s</span></td><td><code>%s</code></td><td>%s</td><td>%s</td></tr>\n' "$repo" "$id" "$caps" "$branch" "$commit" "$state" "$state" "$command" "$checked" "$follow"
  done < "$catalog"
  printf '%s\n' '</table></div><footer>A project becomes verified only through a clean checkout, a pinned commit, the pinned Simple beta tag/commit, and an explicit successful test receipt. This page never queries GitHub or runs projects.</footer></section><p><a href="index.html">Capability dashboard</a></p></body></html>'
} > "$output"
if [ "$bad" -ne 0 ]; then echo 'FAIL: one or more project receipts were invalid; page renders no verified claim for them' >&2; exit 1; fi
echo "PASS: rendered $output"

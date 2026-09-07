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
release_repo=$(one "$release" repository); release_tag=$(one "$release" tag); release_commit=$(one "$release" commit)
[ "$release_repo" = https://github.com/ormastes/simple ] && [ "$release_tag" = v1.0.1-beta.1 ] && printf '%s' "$release_commit" | grep -Eq '^[0-9a-f]{40}$' || exit 2
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
bad=0
{
  printf '%s\n' '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>simply — Project proofs</title><link rel="stylesheet" href="glass.css"></head><body>'
  printf '%s\n' '<header class="hero"><h1>Simple project propagation</h1><p>Immutable, offline proof receipts. Missing or invalid evidence is never a working claim.</p>'
  printf '<p>Compatibility baseline: <a href="%s/tree/%s">%s</a> (<a href="%s/commit/%s"><code>%s</code></a>, beta).</p></header>' "$release_repo" "$release_tag" "$release_tag" "$release_repo" "$release_commit" "$release_commit"
  printf '%s\n' '<section class="card"><h2>Advertised projects</h2><div class="tblwrap"><table><tr><th>project</th><th>branch</th><th>project revision</th><th>proof</th><th>SSpec / test</th><th>last known</th><th>follow-up</th></tr>'
  while IFS='|' read -r id repo branch caps; do
    case "$id" in ''|'#'*) continue;; esac
    proof="$receipts/$id.sdn"; state=unverified; commit='—'; evidence='—'; command='—'; checked='—'; follow='receipt required'
    if [ -f "$proof" ]; then
      project=$(one "$proof" project 2>/dev/null || true); prepo=$(one "$proof" repository 2>/dev/null || true); pbranch=$(one "$proof" branch 2>/dev/null || true)
      schema=$(one "$proof" schema 2>/dev/null || true); sha=$(one "$proof" commit 2>/dev/null || true); stag=$(one "$proof" simple_tag 2>/dev/null || true); ssha=$(one "$proof" simple_commit 2>/dev/null || true); sbinary=$(one "$proof" simple_binary_sha256 2>/dev/null || true); sversion=$(one "$proof" simple_version_sha256 2>/dev/null || true)
      tree=$(one "$proof" tree 2>/dev/null || true); result=$(one "$proof" test_result 2>/dev/null || true); command=$(one "$proof" test_command 2>/dev/null || true); exit_code=$(one "$proof" test_exit 2>/dev/null || true); digest=$(one "$proof" test_output_sha256 2>/dev/null || true); specs=$(one "$proof" sspec_paths 2>/dev/null || true); review=$(one "$proof" sspec_review 2>/dev/null || true); checked=$(one "$proof" checked_at 2>/dev/null || true); follow=$(one "$proof" follow_up 2>/dev/null || true)
      tag_count=$(grep -c '^project_tag=' "$proof" || true); tag_commit_count=$(grep -c '^project_tag_commit=' "$proof" || true); tag_ok=0; project_tag=none
      if [ "$tag_count" -eq 0 ] && [ "$tag_commit_count" -eq 0 ]; then tag_ok=1
      elif [ "$tag_count" -eq 1 ] && [ "$tag_commit_count" -eq 1 ]; then
        project_tag=$(one "$proof" project_tag 2>/dev/null || true); project_tag_commit=$(one "$proof" project_tag_commit 2>/dev/null || true)
        [ "$project_tag_commit" = "$sha" ] && safe_text "$project_tag" && tag_ok=1
      fi
      specs_ok=1; old_ifs=$IFS; IFS=,
      for spec in $specs; do case "$spec" in test/*_spec.spl) ;; *) specs_ok=0;; esac; done
      IFS=$old_ifs
      identity_ok=0
      if [ "$schema" = project-proof-v1 ] && [ "$project" = "$id" ] && [ "$prepo" = "$repo" ] && [ "$pbranch" = "$branch" ] && printf '%s' "$sha" | grep -Eq '^[0-9a-f]{40}$' && [ "$stag" = "$release_tag" ] && [ "$ssha" = "$release_commit" ] && printf '%s' "$sbinary" | grep -Eq '^[0-9a-f]{64}$' && printf '%s' "$sversion" | grep -Eq '^[0-9a-f]{64}$' && [ "$tag_ok" -eq 1 ]; then identity_ok=1; fi
      evidence_ok=0
      if [ "$identity_ok" -eq 1 ] && [ "$tree" = clean ] && printf '%s' "$digest" | grep -Eq '^[0-9a-f]{64}$' && [ "$specs_ok" -eq 1 ] && [ -n "$specs" ] && [ "$review" = basic-static ] && safe_text "$command" && safe_text "$specs" && printf '%s' "$checked" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$' && safe_text "$follow"; then evidence_ok=1; fi
      if [ "$evidence_ok" -eq 1 ] && [ "$result" = verified ] && [ "$exit_code" = 0 ]; then state=verified
      elif [ "$evidence_ok" -eq 1 ] && [ "$result" = failed ] && printf '%s' "$exit_code" | grep -Eq '^[1-9][0-9]*$'; then state=failed
      else state=failed; bad=1; command='—'; checked='—'; follow='repair receipt or test'; fi
      if [ "$identity_ok" -eq 1 ]; then
        commit="<a href=\"$repo/commit/$sha\"><code>$sha</code></a>"
        [ "$project_tag" = none ] || commit="$commit<br><small>tag $project_tag</small>"
      else commit='invalid receipt'; fi
      if [ "$evidence_ok" -eq 1 ]; then
        evidence="<code>$command</code><br><small>review: $review</small>"
        old_ifs=$IFS; IFS=,
        for spec in $specs; do evidence="$evidence<br><a href=\"$repo/blob/$sha/$spec\">$spec</a>"; done
        IFS=$old_ifs
      fi
    fi
    printf '<tr><td><a href="%s">%s</a><br><small>%s</small></td><td>%s</td><td>%s</td><td><span class="st st-%s">%s</span></td><td>%s</td><td>%s</td><td>%s</td></tr>\n' "$repo" "$id" "$caps" "$branch" "$commit" "$state" "$state" "$evidence" "$checked" "$follow"
  done < "$catalog"
  printf '%s\n' '</table></div><footer>A project becomes verified only through a clean checkout, a pinned commit, the pinned Simple beta tag/commit, and an explicit successful test receipt. This page never queries GitHub or runs projects.</footer></section><p><a href="index.html">Capability dashboard</a></p></body></html>'
} > "$output"
if [ "$bad" -ne 0 ]; then echo 'FAIL: one or more project receipts were invalid; page renders no verified claim for them' >&2; exit 1; fi
echo "PASS: rendered $output"

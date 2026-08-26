#!/bin/sh
# Regenerates docs/index.html from data/registry.sdn, plus a live test-status
# panel from data/test_results.json when present (the output of
# `simple test --json` in ormastes/simple: totals + per-directory `groups`
# with done_pct — see that repo's test_runner_output.spl).
# ponytail: plain shell generator; replace with a Simple .spl generator driven
# directly by `simple test --json` once a released simple binary runs in CI.
set -eu
cd "$(dirname "$0")/.."

# Recursion guard: simply must never contain a vendored simple/simply checkout.
BAD=$(find examples -name .git -maxdepth 4 2>/dev/null | head -1 || true)
if [ -n "$BAD" ] || [ -e simple/.git ] || [ -d simply ]; then
  echo "FAIL — nested repo checkout detected (${BAD:-simple|simply dir}); simply references sibling repos by URL only" >&2
  exit 1
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# ---- Test-status panel (optional) --------------------------------------
# Reads the `spec` object of the combined test JSON. The emitter writes group
# keys in a fixed order (name,passed,failed,skipped,pending,done_pct), so a
# line-based extraction is sufficient — no JSON parser needed.
if [ -f data/test_results.json ]; then
  tr ',' '\n' < data/test_results.json | tr -d '{}[]"' > "$TMP/kv"
  TP=$(grep -m1 '^total_passed:' "$TMP/kv" | cut -d: -f2 || echo 0)
  TF=$(grep -m1 '^total_failed:' "$TMP/kv" | cut -d: -f2 || echo 0)
  TPD=$(grep -m1 '^total_pending:' "$TMP/kv" | cut -d: -f2 || echo "")
  grep -o '{"name":"[^"]*","passed":[0-9]*,"failed":[0-9]*,"skipped":[0-9]*,"pending":[0-9]*,"done_pct":[0-9]*}' data/test_results.json > "$TMP/groups" || true
  {
    printf '<section class=card><h2>Test status <span class=pct>%s passed / %s failed' "$TP" "$TF"
    [ -n "$TPD" ] && printf ' / %s planned+pending' "$TPD"
    printf '</span></h2>'
    if [ -s "$TMP/groups" ]; then
      printf '<div class=tblwrap><table><tr><th>test group</th><th>passed</th><th>failed</th><th>skipped</th><th>pending</th><th>done</th></tr>'
      sed 's/[{}"]//g' "$TMP/groups" | while IFS= read -r g; do
        name=${g#name:}; name=${name%%,*}
        p=$(printf '%s' "$g" | sed -n 's/.*passed:\([0-9]*\).*/\1/p')
        f=$(printf '%s' "$g" | sed -n 's/.*failed:\([0-9]*\).*/\1/p')
        s=$(printf '%s' "$g" | sed -n 's/.*skipped:\([0-9]*\).*/\1/p')
        pe=$(printf '%s' "$g" | sed -n 's/.*pending:\([0-9]*\).*/\1/p')
        d=$(printf '%s' "$g" | sed -n 's/.*done_pct:\([0-9]*\).*/\1/p')
        printf '<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td class=done><b>%s%%</b><div class=bar><div style="width:%s%%"></div></div></td></tr>' \
          "$name" "$p" "$f" "$s" "$pe" "$d" "$d"
      done
      printf '</table></div>'
    fi
    printf '<footer>From <code>simple test --json</code>, committed as data/test_results.json. Planned specs (future-impl markers) count as pending, never as failures.</footer></section>'
  } > "$TMP/panel.html"
else
  : > "$TMP/panel.html"
fi

# ---- Header ------------------------------------------------------------
COUNT=$(grep -cv '^#' data/registry.sdn)
AVG=$(awk -F'|' '/^#/||NF<9{next}{t+=$7;n++}END{printf "%.0f", t/n}' data/registry.sdn)
{
  printf '<!doctype html><html lang=en><head><meta charset=utf-8>'
  printf '<meta name=viewport content="width=device-width,initial-scale=1">'
  printf '<title>simply — whole-earth software in Simple</title>'
  printf '<link rel=stylesheet href=glass.css></head><body>'
  printf '<header class=hero><h1>simply</h1><p>Whole-earth software, implemented in the <a href="https://github.com/ormastes/simple">Simple</a> language. One capability registry, %s rows, honestly scored.</p>' "$COUNT"
  printf '<div class=big>%s%%<span> overall composite</span></div>' "$AVG"
  printf '<p class=links><a href="https://github.com/ormastes/simply/blob/main/doc/plan/implementation_map.md">implementation map</a> · <a href="https://github.com/ormastes/simply/blob/main/doc/plan/design.md">design</a> · <a href="https://github.com/ormastes/simply/tree/main/examples">examples</a></p></header>'
} > "$TMP/head.html"

# ---- Registry sections -------------------------------------------------
awk -F'|' '
/^#/ || NF < 9 { next }
{
  id=$1; g=$2; name=$3; f=$4; u=$5; p=$6; d=$7; st=$8; sp=$9
  if (!(g in seen)) { seen[g]=1; order[ng++]=g }
  n[g]++
  rows[g] = rows[g] sprintf("<tr><td class=id>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td class=done><b>%s%%</b></td><td><span class=\"st st-%s\">%s</span></td><td class=sspec>%s</td></tr>\n", id, name, f, u, p, d, st, st, sp)
  gsum[g]+=d
}
END {
  for (i=0;i<ng;i++) {
    g=order[i]
    printf "<section class=card><h2>%s <span class=pct>%.0f%%</span></h2>", g, gsum[g]/n[g]
    printf "<div class=bar><div style=\"width:%.0f%%\"></div></div>", gsum[g]/n[g]
    printf "<div class=tblwrap><table><tr><th>id</th><th>capability</th><th>F</th><th>U</th><th>P</th><th>done</th><th>status</th><th>sspec</th></tr>%s</table></div></section>", rows[g]
  }
  printf "<footer>Generated %s by scripts/update_site.sh from data/registry.sdn. Scores are repo-audit estimates (±10pt); the test panel above (when present) is produced by SSpec runs.</footer>", strftime("%Y-%m-%d")
  printf "</body></html>"
}' data/registry.sdn > "$TMP/body.html"

cat "$TMP/head.html" "$TMP/panel.html" "$TMP/body.html" > docs/index.html
echo "PASS — docs/index.html regenerated from $COUNT registry rows$( [ -f data/test_results.json ] && echo ' + test panel' )"

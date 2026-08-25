#!/bin/sh
# Regenerates docs/index.html from data/registry.sdn. POSIX sh + awk only.
# ponytail: plain shell generator; replace with a Simple .spl generator driven
# by `simple test --json` once a released simple binary is consumable in CI.
set -eu
cd "$(dirname "$0")/.."

# Recursion guard: simply must never contain a vendored simple/simply checkout.
BAD=$(find examples -name .git -maxdepth 4 2>/dev/null | head -1 || true)
if [ -n "$BAD" ] || [ -e simple/.git ] || [ -d simply ]; then
  echo "FAIL — nested repo checkout detected (${BAD:-simple|simply dir}); simply references sibling repos by URL only" >&2
  exit 1
fi

awk -F'|' '
BEGIN {
  ng = 0
}
/^#/ || NF < 9 { next }
{
  id=$1; g=$2; name=$3; f=$4; u=$5; p=$6; d=$7; st=$8; sp=$9
  if (!(g in seen)) { seen[g]=1; order[ng++]=g }
  n[g]++
  rows[g] = rows[g] sprintf("<tr><td class=id>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td class=done><b>%s%%</b></td><td><span class=\"st st-%s\">%s</span></td><td class=sspec>%s</td></tr>\n", id, name, f, u, p, d, st, st, sp)
  gsum[g]+=d; total+=d; count++
}
END {
  printf "<!doctype html><html lang=en><head><meta charset=utf-8>"
  printf "<meta name=viewport content=\"width=device-width,initial-scale=1\">"
  printf "<title>simply — whole-earth software in Simple</title>"
  printf "<link rel=stylesheet href=glass.css></head><body>"
  printf "<header class=hero><h1>simply</h1><p>Whole-earth software, implemented in the <a href=\"https://github.com/ormastes/simple\">Simple</a> language. One capability registry, %d rows, honestly scored.</p>", count
  printf "<div class=big>%.0f%%<span> overall composite</span></div>", total/count
  printf "<p class=links><a href=\"https://github.com/ormastes/simply/blob/main/doc/plan/implementation_map.md\">implementation map</a> · <a href=\"https://github.com/ormastes/simply/blob/main/doc/plan/design.md\">design</a> · <a href=\"https://github.com/ormastes/simply/tree/main/examples\">examples</a></p></header>"
  for (i=0;i<ng;i++) {
    g=order[i]
    printf "<section class=card><h2>%s <span class=pct>%.0f%%</span></h2>", g, gsum[g]/n[g]
    printf "<div class=bar><div style=\"width:%.0f%%\"></div></div>", gsum[g]/n[g]
    printf "<div class=tblwrap><table><tr><th>id</th><th>capability</th><th>F</th><th>U</th><th>P</th><th>done</th><th>status</th><th>sspec</th></tr>%s</table></div></section>", rows[g]
  }
  printf "<footer>Generated %s by scripts/update_site.sh from data/registry.sdn. Scores are repo-audit estimates (±10pt); status flips to test-driven once SSpec JSON export lands.</footer>", strftime("%Y-%m-%d")
  printf "</body></html>"
}' data/registry.sdn > docs/index.html

echo "PASS — docs/index.html regenerated from $(grep -cv '^#' data/registry.sdn) registry rows"

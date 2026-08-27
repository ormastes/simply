#!/bin/sh
# Regenerates docs/index.html from data/registry.sdn.
#
# `done` and `status` are DERIVED, never transcribed: for every registry row
# this reads the row's test list from data/tests.sdn, matches those paths
# against data/test_results.json (verbatim `simple test --json` output from
# ormastes/simple) and computes the gates and the status ladder defined in
# doc/plan/completion_criteria.md. A row with no matching test evidence renders
# as `unproven` / `no evidence` — deliberately distinct from 0%, which means
# tests exist and fail. Columns 7 and 8 of data/registry.sdn are rewritten in
# place from the derived values so the file can never disagree with the page.
#
# Exit codes: 0 = fresh, 1 = generated but STALE (missing/old results, or a
# unit/system mapping that matches no spec file), 2 = refused to generate.
# ponytail: plain POSIX sh + awk; simply's CI has no Simple binary yet.
set -eu
cd "$(dirname "$0")/.."

# Recursion guard: simply must never contain a vendored simple/simply checkout.
BAD=$(find examples -name .git -maxdepth 4 2>/dev/null | head -1 || true)
if [ -n "$BAD" ] || [ -e simple/.git ] || [ -d simply ]; then
  echo "FAIL — nested repo checkout detected (${BAD:-simple|simply dir}); simply references sibling repos by URL only" >&2
  exit 2
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
: > "$TMP/warn"

# ---- Freshness ---------------------------------------------------------
# git commit time is authoritative: a CI checkout flattens every mtime to the
# clone time, which would make an mtime-only comparison vacuously fresh.
ts() {
  t=$(git log -1 --format=%ct -- "$1" 2>/dev/null || true)
  [ -n "$t" ] || t=$(stat -c %Y "$1" 2>/dev/null || echo 0)
  echo "${t:-0}"
}

if [ ! -f data/test_results.json ]; then
  echo "data/test_results.json is missing — no capability status can be earned from evidence." >> "$TMP/warn"
  : > "$TMP/results.json"
  RESULTS=$TMP/results.json
else
  RESULTS=data/test_results.json
  TR=$(ts data/test_results.json); RG=$(ts data/registry.sdn); TS=$(ts data/tests.sdn)
  [ "$TR" -lt "$RG" ] && echo "data/test_results.json is OLDER than data/registry.sdn — the numbers below predate the current capability list." >> "$TMP/warn"
  [ "$TR" -lt "$TS" ] && echo "data/test_results.json is OLDER than data/tests.sdn — the numbers below predate the current test mapping." >> "$TMP/warn"
fi

DATE=$(date -u +%Y-%m-%d)
RESULTS_DATE=$( [ -s "$RESULTS" ] && git log -1 --format=%cs -- data/test_results.json 2>/dev/null || true )
[ -n "${RESULTS_DATE:-}" ] || RESULTS_DATE="unknown"

# ---- Derivation + render ------------------------------------------------
# Pass 1  test_results.json : pretty-printed; a line-based state machine reads
#         the groups[] (panel) and files[] (per-row evidence) objects.
# Pass 2  tests.sdn         : id|kind|path mappings.
# Pass 3  registry.sdn      : identity columns (id|group|name|F|U|P) are the
#         hand-authored source of truth; done/status are recomputed.
awk -v DATE="$DATE" -v RDATE="$RESULTS_DATE" \
    -v REGOUT="$TMP/registry.sdn" -v WARNOUT="$TMP/warn.derived" '
function sval(  s) {
  if (match($0, /: *"[^"]*"/)) { s = substr($0, RSTART, RLENGTH); sub(/^: *"/, "", s); sub(/"$/, "", s); return s }
  return ""
}
function nval(  s) {
  if (match($0, /: *-?[0-9.]+/)) { s = substr($0, RSTART); sub(/^: */, "", s); sub(/[^0-9.].*$/, "", s); return s + 0 }
  return 0
}
function esc(s) { gsub(/&/, "\\&amp;", s); gsub(/</, "\\&lt;", s); gsub(/>/, "\\&gt;", s); return s }
function pct(a, b) { return (a + b) > 0 ? 100.0 * a / (a + b) : -1 }
function link(p,  u) {
  if (p !~ /^test\//) return "<span class=nolink>" esc(p) "</span>"
  u = "https://github.com/ormastes/simple/" (p ~ /\.spl$/ ? "blob" : "tree") "/main/" p
  return "<a href=\"" u "\">" esc(p) "</a>"
}

# ---------------- pass 1: test_results.json ----------------
FILENAME ~ /\.json$/ {
  if ($0 ~ /"groups" *:/) { sec = "g"; next }
  if ($0 ~ /"files" *:/)  { sec = "f"; next }
  if ($0 ~ /"total_passed" *:/)  { TP  = nval(); next }
  if ($0 ~ /"total_failed" *:/)  { TF  = nval(); next }
  if ($0 ~ /"total_skipped" *:/) { TS_ = nval(); next }
  if ($0 ~ /"total_pending" *:/) { TPD = nval(); next }
  if ($0 ~ /"name" *:/) { cur = sval(); next }
  if ($0 ~ /"path" *:/) { cur = sval(); next }
  if ($0 ~ /"passed" *:/)  { cp = nval(); next }
  if ($0 ~ /"failed" *:/)  { cf = nval(); next }
  if ($0 ~ /"skipped" *:/) { cs = nval(); next }
  if ($0 ~ /"pending" *:/) { ce = nval(); next }
  if ($0 ~ /"done_pct" *:/ && sec == "g") {
    ng++; gname[ng] = cur; gp[ng] = cp; gf[ng] = cf; gs[ng] = cs; ge[ng] = ce; gd[ng] = nval(); next
  }
  if ($0 ~ /"duration_ms" *:/ && sec == "f") {
    nf++; fpath[nf] = cur; fp[nf] = cp; ff[nf] = cf; fs[nf] = cs; fe[nf] = ce; next
  }
  next
}

# ---------------- pass 2: tests.sdn ----------------
FILENAME ~ /tests\.sdn$/ {
  if ($0 ~ /^#/ || $0 ~ /^[ \t]*$/) next
  n = split($0, a, "|")
  if (n < 3) next
  nt++; tid[nt] = a[1]; tkind[nt] = a[2]; tpath[nt] = a[3]
  next
}

# ---------------- pass 3: registry.sdn ----------------
/^#/ { reghdr[++nh] = $0; next }
{
  n = split($0, a, "|")
  if (n < 9) next
  nr++
  rid[nr] = a[1]; rgrp[nr] = a[2]; rname[nr] = a[3]
  rF[nr] = a[4]; rU[nr] = a[5]; rP[nr] = a[6]
}

END {
  # --- resolve every mapping against files[] ---
  for (j = 1; j <= nt; j++) {
    id = tid[j]; k = tkind[j]; p = tpath[j]
    have[id] = 1
    maps[id] = maps[id] (maps[id] == "" ? "" : "\n") k "|" p
    if (p !~ /^test\//) { descr[id]++; continue }
    m = 0
    for (i = 1; i <= nf; i++) {
      if (fpath[i] == p || index(fpath[i], p "/") == 1) {
        m++
        key = id SUBSEP fpath[i]
        if (key in seen) continue      # a row may map both a dir and a file under it
        seen[key] = 1
        gpassed[id, k] += fp[i]; gfailed[id, k] += ff[i]
        gpend[id, k] += fe[i]; gskip[id, k] += fs[i]
        gfiles[id, k]++
      }
    }
    hits[id, k, p] = m
    if (m == 0 && (k == "unit" || k == "system")) {
      # Two different failures, kept apart so the fix is obvious: a mapping
      # under a tree the run DID cover is a broken/renamed path; a mapping
      # under a tree the run never touched is a coverage gap in the run.
      split(p, pc, "/"); tree = pc[1] "/" pc[2] "/"
      covered = 0
      for (i2 = 1; i2 <= nf; i2++) if (index(fpath[i2], tree) == 1) { covered = 1; break }
      if (covered) dangling = dangling (dangling == "" ? "" : ", ") id ":" p
      else uncovered = uncovered (uncovered == "" ? "" : ", ") id ":" p
    }
  }

  # With no results at all the "missing test_results.json" warning already says
  # everything; listing all 39 mappings on top of it is noise, not information.
  if (nf == 0) { dangling = ""; uncovered = "" }
  if (dangling != "")
    print "mapping(s) name a path under a tree this run DID cover, yet match no spec file — broken or renamed mapping: " dangling >> WARNOUT
  if (uncovered != "")
    print "mapping(s) point into a test tree this run never executed, so their gate cannot be earned: " uncovered >> WARNOUT
  close(WARNOUT)   # flush before the banner re-reads it below

  # --- per-row gates, done%, status ---
  for (r = 1; r <= nr; r++) {
    id = rid[r]
    up = gpassed[id, "unit"];   uf = gfailed[id, "unit"]
    sp = gpassed[id, "system"]; sf = gfailed[id, "system"]
    bp = gpassed[id, "bench"];  bf = gfailed[id, "bench"]
    pl = gfiles[id, "planned"]
    F = pct(up, uf); U = pct(sp, sf); P = pct(bp, bf)
    dF[r] = F; dU[r] = U; dP[r] = P
    ev[r] = gfiles[id, "unit"] + gfiles[id, "system"] + gfiles[id, "bench"] + pl
    passed[r] = up + sp + bp; failed[r] = uf + sf + bf
    pending[r] = gpend[id, "unit"] + gpend[id, "system"] + gpend[id, "bench"] + gpend[id, "planned"]

    num = 0; den = 0
    if (F >= 0) { num += 55 * F; den += 55 }
    if (U >= 0) { num += 25 * U; den += 25 }
    if (P >= 0) { num += 20 * P; den += 20 }
    if (den == 0) { done[r] = -1 } else { done[r] = int(num / den + 0.5) }

    if (ev[r] == 0)                       st[r] = "unproven"
    else if (F < 0 && U < 0 && P < 0)     st[r] = "source_present"   # planned markers only
    else if (F >= 0 && uf == 0 && U >= 0 && sf == 0) st[r] = "system_verified"
    else if (F >= 0 && uf == 0)           st[r] = "unit_verified"
    else                                  st[r] = "source_present"
    # `usable` is never auto-awarded: it requires a reproducible-by-a-newcomer
    # judgement that no test run can evidence.

    if (done[r] < 0) unproven++; else { proven++; compsum += done[r] }
  }

  # --- rewrite data/registry.sdn columns 7-8 from the derived values ---
  for (i = 1; i <= nh; i++) print reghdr[i] > REGOUT
  for (r = 1; r <= nr; r++)
    printf "%s|%s|%s|%s|%s|%s|%s|%s|%s\n", rid[r], rgrp[r], rname[r], rF[r], rU[r], rP[r],
      (done[r] < 0 ? "-" : done[r]), st[r], (maps[rid[r]] != "" ? "mapped" : "-") > REGOUT

  # ================= page =================
  print "<!doctype html><html lang=en><head><meta charset=utf-8>"
  print "<meta name=viewport content=\"width=device-width,initial-scale=1\">"
  print "<title>simply — whole-earth software in Simple</title>"
  print "<link rel=stylesheet href=glass.css></head><body>"
  printf "<header class=hero><h1>simply</h1><p>Whole-earth software, implemented in the <a href=\"https://github.com/ormastes/simple\">Simple</a> language. One capability registry, %d rows — every percentage below is <b>earned from test evidence</b>, never hand-typed.</p>", nr
  if (proven > 0)
    printf "<div class=big>%d%%<span> composite over the %d row(s) with evidence</span></div>", int(compsum / proven + 0.5), proven
  else
    printf "<div class=big>—<span> no row has test evidence</span></div>"
  printf "<p class=links><a href=\"https://github.com/ormastes/simply/blob/main/doc/plan/implementation_map.md\">implementation map</a> · <a href=\"https://github.com/ormastes/simply/blob/main/doc/plan/completion_criteria.md\">completion criteria</a> · <a href=\"https://github.com/ormastes/simply/tree/main/examples\">examples</a></p></header>"

  # --- staleness banner ---
  nw = 0
  while ((getline w < WARNIN) > 0) warn[++nw] = w
  close(WARNIN)
  while ((getline w < WARNOUT) > 0) warn[++nw] = w
  close(WARNOUT)
  if (nw > 0) {
    printf "<section class=\"card stale\"><h2>⚠ STALE — these numbers are not trustworthy</h2><ul>"
    for (i = 1; i <= nw; i++) printf "<li>%s</li>", esc(warn[i])
    printf "</ul><footer>The generator exited non-zero; CI fails on this state rather than quietly publishing old numbers.</footer></section>"
  }

  # --- evidence summary ---
  printf "<section class=card><h2>Evidence coverage <span class=pct>%d proven / %d unproven</span></h2>", proven, unproven
  printf "<footer>A row is <b>unproven</b> when data/tests.sdn maps it to no spec file that appears in the test run — it shows <i>no evidence</i>, never a percentage. <b>0%%</b> means the opposite: tests ran and failed. Gates per completion_criteria.md: F = unit pass-rate, U = system pass-rate, P = bench pass-rate, done = 55F+25U+20P renormalized over the gates that are actually measured (pending and skipped are outside every denominator, so <code>planned()</code> markers can never drag a score down). Test data: <code>data/test_results.json</code> (%s).</footer></section>", esc(RDATE)

  # --- test panel from groups[] ---
  if (ng > 0) {
    printf "<section class=card><h2>Test status <span class=pct>%d passed / %d failed / %d pending / %d skipped</span></h2>", TP, TF, TPD, TS_
    printf "<div class=tblwrap><table><tr><th>test group</th><th>passed</th><th>failed</th><th>skipped</th><th>pending</th><th>done</th></tr>"
    for (i = 1; i <= ng; i++)
      printf "<tr><td>%s</td><td>%d</td><td>%d</td><td>%d</td><td>%d</td><td class=done><b>%.1f%%</b><div class=bar><div style=\"width:%.1f%%\"></div></div></td></tr>",
        esc(gname[i]), gp[i], gf[i], gs[i], ge[i], gd[i], gd[i]
    printf "</table></div><footer>Verbatim <code>simple test --json</code> groups. Planned specs count as pending, never as failures.</footer></section>"
  }

  # --- registry sections ---
  for (r = 1; r <= nr; r++) {
    g = rgrp[r]
    if (!(g in gseen)) { gseen[g] = 1; gorder[++nog] = g }
    gn[g]++
    if (done[r] >= 0) { gsum[g] += done[r]; gpv[g]++ }

    # tests column: every mapping, linked, with its own file count
    tc = ""
    nm = split(maps[rid[r]], ml, "\n")
    for (i = 1; i <= nm; i++) {
      if (ml[i] == "") continue
      split(ml[i], mm, "|")
      h = hits[rid[r], mm[1], mm[2]]
      tc = tc "<div class=ev><span class=\"k k-" mm[1] "\">" mm[1] "</span> " link(mm[2]) \
           (mm[2] ~ /^test\// ? " <span class=cnt>" (h + 0) " file(s)</span>" : "") "</div>"
    }
    if (tc == "") tc = "<span class=nolink>no test list</span>"

    if (done[r] < 0) dcell = "<span class=noev>no evidence</span>"
    else dcell = sprintf("<b>%d%%</b><div class=bar><div style=\"width:%d%%\"></div></div>", done[r], done[r])

    if (ev[r] == 0) ecell = "<span class=noev>—</span>"
    else ecell = sprintf("<span class=p>%d</span>/<span class=f>%d</span>/<span class=e>%d</span>", passed[r], failed[r], pending[r])

    rows[g] = rows[g] sprintf("<tr><td class=id>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td class=ct>%s</td><td class=done>%s</td><td><span class=\"st st-%s\">%s</span></td><td class=sspec>%s</td></tr>\n",
      rid[r], esc(rname[r]), rF[r], rU[r], rP[r], ecell, dcell, st[r], st[r], tc)
  }

  for (i = 1; i <= nog; i++) {
    g = gorder[i]
    if (gpv[g] > 0) { avg = gsum[g] / gpv[g]; hdr = sprintf("%.0f%% <small>(%d of %d rows proven)</small>", avg, gpv[g], gn[g]) }
    else { avg = 0; hdr = sprintf("no evidence <small>(0 of %d rows proven)</small>", gn[g]) }
    printf "<section class=card><h2>%s <span class=pct>%s</span></h2>", esc(g), hdr
    printf "<div class=bar><div style=\"width:%.0f%%\"></div></div>", avg
    printf "<div class=tblwrap><table><tr><th>id</th><th>capability</th><th title=\"hand-authored audit estimate\">F</th><th title=\"hand-authored audit estimate\">U</th><th title=\"hand-authored audit estimate\">P</th><th title=\"passed/failed/pending from the mapped spec files\">evidence</th><th>done (derived)</th><th>status (derived)</th><th>tests</th></tr>%s</table></div></section>", rows[g]
  }
  printf "<footer>Generated %s by scripts/update_site.sh. F/U/P are the hand-authored audit estimates from data/registry.sdn; <b>done and status are derived</b> from data/tests.sdn × data/test_results.json per doc/plan/completion_criteria.md and are rewritten back into the registry by this generator.</footer>", DATE
  print "</body></html>"
}' WARNIN="$TMP/warn" "$RESULTS" data/tests.sdn data/registry.sdn > "$TMP/index.html" 2>"$TMP/awkerr" || {
  echo "FAIL — generator error:" >&2; cat "$TMP/awkerr" >&2; exit 2; }

mv "$TMP/index.html" docs/index.html
mv "$TMP/registry.sdn" data/registry.sdn

STALE=0
if [ -s "$TMP/warn" ] || [ -s "$TMP/warn.derived" ]; then STALE=1; fi
ROWS=$(grep -cv '^#' data/registry.sdn || true)
UNPROVEN=$(awk -F'|' '!/^#/ && NF>=8 && $8=="unproven"' data/registry.sdn | wc -l)
if [ "$STALE" -eq 1 ]; then
  echo "FAIL — docs/index.html regenerated from $ROWS rows ($UNPROVEN unproven) but the evidence is STALE:" >&2
  cat "$TMP/warn" "$TMP/warn.derived" >&2 2>/dev/null || true
  exit 1
fi
echo "PASS — docs/index.html regenerated: $ROWS registry rows, $((ROWS - UNPROVEN)) with test evidence, $UNPROVEN unproven"

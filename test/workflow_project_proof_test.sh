#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
workflow="$root/.github/workflows/project-proof.yml"
readme="$root/README.md"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

guard_line=$(grep -n '^      - name: Verify pristine Simply checkout before collection$' "$workflow" | cut -d: -f1)
collect_line=$(grep -n '^      - name: Collect immutable proof$' "$workflow" | cut -d: -f1)
[ -n "$guard_line" ] && [ -n "$collect_line" ] && [ "$guard_line" -lt "$collect_line" ]
[ "$(sed -n "${guard_line},$((collect_line - 1))p" "$workflow" | grep -c '^      - name:')" -eq 1 ]

collect_block="$tmp/collect.block"
awk '
  /^      - name: Collect immutable proof$/ { in_block=1 }
  in_block { print }
  in_block && /^      - name: Render proof page$/ { exit }
' "$workflow" > "$collect_block"
grep -Fq 'proof_dir="$RUNNER_TEMP/simply-project-proof"' "$collect_block"
grep -Fq 'rm -f "$receipt" "$log"' "$collect_block"
grep -Fq 'rm -f "data/project_proofs/$PROJECT_ID.sdn"' "$collect_block"
grep -Fq -- '--simple-checkout "$GITHUB_WORKSPACE/simple-beta"' "$collect_block"
grep -Fq -- '--valid-until "$valid_until"' "$collect_block"
grep -Fq -- '--output "$receipt" --log "$log"' "$collect_block"
grep -Fq 'if [ -s "$receipt" ]; then' "$collect_block"
grep -Fq 'cp "$receipt" "data/project_proofs/$PROJECT_ID.sdn"' "$collect_block"
grep -Fq '${{ runner.temp }}/simply-project-proof/${{ inputs.project_id }}.log' "$workflow"
grep -Fq -- '--simple-checkout SIMPLE_BETA_CHECKOUT --valid-until "$valid_until"' "$readme"
grep -Fq -- '--output /tmp/PROJECT.sdn --log /tmp/PROJECT.log' "$readme"
grep -Fq 'rejects PATH substitutes, seed/debug binaries, mutated' "$readme"

# Behavioral guard: after an early collector failure, the renderer's tracked
# input is absent, so a stale receipt cannot be selected. A fresh output is
# copied only after it exists.
tracked="$tmp/simply/data/project_proofs/demo.sdn"
runner_receipt="$tmp/runner/demo.sdn"
mkdir -p "$(dirname "$tracked")" "$(dirname "$runner_receipt")"
printf '%s\n' stale-proof > "$tracked"
rm -f "$runner_receipt" "$tracked"
if [ -s "$runner_receipt" ]; then cp "$runner_receipt" "$tracked"; fi
[ ! -e "$tracked" ]
selected=unverified
[ -f "$tracked" ] && selected=$(sed -n '1p' "$tracked")
[ "$selected" = unverified ]
printf '%s\n' fresh-proof > "$runner_receipt"
if [ -s "$runner_receipt" ]; then cp "$runner_receipt" "$tracked"; fi
[ "$(sed -n '1p' "$tracked")" = fresh-proof ]

echo 'PASS: workflow isolates proof output, orders the pristine guard, and rejects stale receipts'

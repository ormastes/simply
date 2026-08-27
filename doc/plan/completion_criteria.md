# Completion criteria

How a registry row (`data/registry.sdn`) earns its scores and status. Every
capability is measured on three independent gates (design rule 4) — passing
unit tests alone never earns a high score.

## The three gates

| Gate | What must exist | Evidence |
|---|---|---|
| **Feature (F)** | Conformance/functional SSpec suites covering the row's "complete target" column against a mature reference class | `simple test --json` groups for the row's test list, all green |
| **Usability (U)** | At least one end-to-end executable workflow (the vertical slices in the implementation map) exercising the row from a user entrypoint | A system-level spec or scripted demo that runs start-to-finish |
| **Performance (P)** | A representative benchmark with a recorded budget, compared to the reference | Benchmark receipt in-repo; re-runnable |

`done = 55F + 25U + 20P` (renormalized when P is not measurable).

## Status ladder

| status | earned by |
|---|---|
| `unproven` | `data/tests.sdn` maps the row to no spec file present in the test run. The dashboard shows **no evidence**, never a percentage — deliberately distinct from `0%`, which means tests ran and failed |
| `declared` | Row exists; criteria written; tests may be `planned()` markers only |
| `source_present` | Implementation source exists; no verifying suite yet |
| `unit_verified` | The row's unit-test list is green in `test --json` |
| `system_verified` | Unit list green AND at least one end-to-end workflow spec green |
| `usable` | system_verified AND the usability gate's workflow is documented and reproducible by a newcomer |

Statuses flip from test evidence, not by hand. `scripts/update_site.sh` reads
`data/test_results.json` (verbatim `simple test --json` output), resolves each
row's `tests.sdn` paths against `files[]` (exact match, or prefix match for a
directory mapping, deduplicated per row), and computes:

- **F** = unit pass-rate = `passed / (passed + failed)` over the row's `unit`
  entries. **U** = the same over `system` entries, **P** over `bench` entries.
  Pending and skipped are outside every denominator, so `planned()` markers can
  never drag a score down.
- `done = 55F + 25U + 20P`, **renormalized over the gates that actually have
  evidence** — a gate with a zero denominator is unmeasured, not zero.
- Status: no evidence at all → `unproven`; only `planned` entries resolved, or
  any unit failure → `source_present`; unit green → `unit_verified`; unit and
  system both green → `system_verified`. `usable` is **never auto-awarded** —
  "reproducible by a newcomer" is not something a test run can evidence.

Columns 7-9 of `data/registry.sdn` (`done|status|sspec`) are **generated**: the
script rewrites them in place, so the file can never disagree with the page.
Columns 1-6 (`id|group|name|F|U|P`) stay hand-authored.

## Staleness (the generator exits non-zero)

A dashboard that quietly shows old numbers is worse than one that admits it is
stale. `scripts/update_site.sh` still renders the page, but prints a STALE
banner on it and exits 1, when any of these hold:

- `data/test_results.json` is missing;
- it is older than `data/tests.sdn`, or older than the last commit that changed
  the **hand-authored** columns 1-6 of `data/registry.sdn` (git commit time,
  falling back to mtime outside a checkout — a CI clone flattens mtimes).
  Comparing against the whole registry file would be self-defeating: the
  generator rewrites columns 7-9 itself, so every run would declare its own
  fresh results stale;
- a `unit`/`system` mapping matches no spec file, split into two causes: the
  run **did** cover that test tree (broken or renamed mapping) or it **never
  executed** that tree (coverage gap in the run).

`.github/workflows/daily-update.yml` commits the rendered page either way and
then fails the job on that exit code. It never synthesises results.

## Test lists (`data/tests.sdn`)

`id|kind|path` rows map registry ids to their verifying tests in
ormastes/simple (or a sibling repo, prefixed `repo:`).

- `kind` = `unit` (feature gate), `system` (usability gate), `bench`
  (performance gate), or `planned` (a future-impl `planned()` spec — declared
  now, implemented later; reports as pending, never failed).
- A row with only `planned` entries can be at most `source_present`.
- Directory paths mean "every `*_spec.spl` beneath".

The dashboard's sspec column shows the row's test list; group done-% in the
test panel comes from the same paths via the runner's `groups` JSON.

## Adding a new capability row

1. Add the registry row with honest F/U/P (audit estimate, ±10pt).
2. Add at least one `tests.sdn` entry — a `planned` marker spec is the
   minimum: declare the test before the feature.
3. State the reference class in the implementation map row.
4. Never duplicate a universal service (architecture rule 1) — extend, don't
   fork.

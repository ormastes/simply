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
| `declared` | Row exists; criteria written; tests may be `planned()` markers only |
| `source_present` | Implementation source exists; no verifying suite yet |
| `unit_verified` | The row's unit-test list is green in `test --json` |
| `system_verified` | Unit list green AND at least one end-to-end workflow spec green |
| `usable` | system_verified AND the usability gate's workflow is documented and reproducible by a newcomer |

Statuses flip from test evidence, not by hand: the daily job reads
`data/test_results.json` (native `simple test --json` output) and a row whose
test list has failures cannot hold `unit_verified` or better.

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

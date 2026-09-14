# Project Provenance Showcase — Agent Tasks

| Lane | Scope | Status |
|---|---|---|
| Receipt model | catalog, beta baseline, offline renderer | implemented |
| Guard | strict root guard and pre-commit-safe mode | implemented |
| Simulator | all required receipt states plus collector and dirty-root proof | implemented |
| SSpec runtime execution | exact beta CI attempt; blocked by `ormastes/simple#497` before test parsing | blocked upstream |
| Live collection | manual workflow emits commit-bound binary/digest receipts from immutable clean catalog checkouts into isolated per-run paths | implemented, awaits usable beta binary |
| Hardening sidecars | lower-model collector, renderer/freshness, and workflow-isolation audits and patches | reviewed and integrated |
| Project admission | review and commit receipts produced by project-specific SSpecs | pending project owners |

Merge owner: Codex. Sidecars: proof-model research, guard research, collector,
renderer/freshness, workflow-isolation, upstream-beta, and delta-review lanes
merged. Final reviewer: highest-capability reviewer verifies generated pages,
receipt acceptance, exclusions, and done marks before any project is promoted
from `unverified`.

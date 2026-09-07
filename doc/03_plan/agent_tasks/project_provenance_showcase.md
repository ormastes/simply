# Project Provenance Showcase — Agent Tasks

| Lane | Scope | Status |
|---|---|---|
| Receipt model | catalog, beta baseline, offline renderer | implemented |
| Guard | strict root guard and pre-commit-safe mode | implemented |
| Simulator | portable valid/dirty receipt proof | implemented |
| SSpec runtime execution | run scenario against an admitted beta runtime | pending beta CI admission |
| Live collection | emit signed project receipts from clean sibling checkouts | pending project owners |

Merge owner: Codex. Sidecars: proof-model research and guard research merged.
Final reviewer: normal/highest-capability reviewer verifies generated pages and
receipt acceptance before any project is promoted from `unverified`.

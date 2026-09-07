# Project Provenance Showcase — Agent Tasks

| Lane | Scope | Status |
|---|---|---|
| Receipt model | catalog, beta baseline, offline renderer | implemented |
| Guard | strict root guard and pre-commit-safe mode | implemented |
| Simulator | all required receipt states plus collector and dirty-root proof | implemented |
| SSpec runtime execution | exact beta CI attempt; blocked by `ormastes/simple#497` before test parsing | blocked upstream |
| Live collection | manual workflow emits binary/digest-bound receipts from clean catalog checkouts | implemented, awaits usable beta binary |
| Project admission | review and commit receipts produced by project-specific SSpecs | pending project owners |

Merge owner: Codex. Sidecars: proof-model research and guard research merged.
Final reviewer: normal/highest-capability reviewer verifies generated pages and
receipt acceptance before any project is promoted from `unverified`.

# Project Provenance Showcase Detail Design

<!-- codex-design -->

## Receipt format

`key=value` records in `data/project_proofs/<slug>.sdn`:

`schema`, `project`, `repository`, `branch`, `commit`, `project_tag`,
`simple_tag`, `simple_commit`, `tree`, `test_command`, `test_result`,
`checked_at`, and `follow_up`.

`project_tag` may be `none`; every other identity/result field is mandatory.
`tree` is `clean` only. `test_result` is `verified`, `failed`, or
`unverified`. A verified result requires clean tree plus the beta tag/commit
pair. The renderer checks every condition itself.

## Page

`docs/projects.html` contains one row per `data/projects.sdn` project: project,
repository, branch, project commit, Simple beta reference, proof state, test
command, timestamp, and follow-up. Commit and tag links use immutable GitHub
URLs. Unavailable receipts produce a truthful unverified row.

## Test approach

The POSIX test exercises the generator against simulator fixtures: verified,
failed, absent, malformed, dirty, and bad beta target. The SSpec contract is a
tracked executable scenario that documents the equivalent states and binds each
REQ-PPS requirement. It runs once the pinned beta toolchain is installable.

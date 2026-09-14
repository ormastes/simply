# Project Provenance Showcase Detail Design

<!-- codex-design -->

## Receipt format

`key=value` records in `data/project_proofs/<slug>.sdn`:

`schema`, `project`, `repository`, `branch`, `commit`, `project_tag`,
`project_tag_commit`,
`simple_tag`, `simple_commit`, `tree`, `test_command`, `test_result`,
`test_exit`, `test_output_sha256`, `sspec_paths`, `sspec_review`, `checked_at`,
`valid_until`, and `follow_up`.

`project_tag` and `project_tag_commit` are an optional pair; every other
identity/result field is mandatory.
`tree` is `clean` only. `test_result` is `verified`, `failed`, or
`unverified`. A verified result requires clean tree plus the beta tag/commit
pair and a fresh deadline. The freshness predicate is strict and deterministic:
`checked_at <= PROOF_NOW < valid_until`, where `PROOF_NOW` is an optional
canonical UTC timestamp override and otherwise the current UTC time. Invalid
calendar timestamps, future-dated `checked_at`, expired deadlines, and an exact
deadline boundary fail closed. The collector/workflow chooses the explicit
validity window; the renderer never guesses one from receipt age. A receipt
path must be a regular file and symlinks are rejected.

The renderer returns `0` when all evidence is accepted, `3` when it safely
renders one or more rejected receipts without a verified claim, and a fatal
status for structural catalog/observation or rendering errors.
`scripts/update_site.sh` accepts only `0` and the safe-degraded `3` status.

## Page

`docs/projects.html` contains one row per `data/projects.sdn` project: project,
repository, branch, project commit, Simple beta reference, proof state, test
command, timestamp, and follow-up. Commit and tag links use immutable GitHub
URLs. Unavailable receipts produce a truthful unverified row.

Every catalog row also has one observation record containing branch, public
head commit, optional deliberately selected tag and resolved commit,
visibility, and observation time. Public revisions link immutably but confer
no proof state. Private rows expose neither commit nor tag metadata.

## Test approach

The POSIX test exercises materialized simulator fixtures: verified, failed,
absent, malformed, dirty, unsafe, duplicate, expired, exact-boundary,
future-dated, symlink, bad beta target, and project-tag states. It fixes
`PROOF_NOW` so the freshness assertions are reproducible. The SSpec invokes
that simulator, the live-collector simulator, and the root-guard simulator,
binding every REQ-PPS requirement to executable behavior.
CI attempts it with the exact pinned beta revision. Until
`ormastes/simple#497` supplies a runnable production beta artifact, the three
portable harnesses are executable evidence and beta SSpec execution remains an
explicit blocker, not an accepted substitute.

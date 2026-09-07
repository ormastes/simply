# Project Provenance Showcase Detail Design

<!-- codex-design -->

## Receipt format

`key=value` records in `data/project_proofs/<slug>.sdn`:

`schema`, `project`, `repository`, `branch`, `commit`, `project_tag`,
`project_tag_commit`,
`simple_tag`, `simple_commit`, `tree`, `test_command`, `test_result`,
`test_exit`, `test_output_sha256`, `sspec_paths`, `sspec_review`, `checked_at`,
and `follow_up`.

`project_tag` and `project_tag_commit` are an optional pair; every other
identity/result field is mandatory.
`tree` is `clean` only. `test_result` is `verified`, `failed`, or
`unverified`. A verified result requires clean tree plus the beta tag/commit
pair. The renderer checks every condition itself.

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
absent, malformed, dirty, unsafe, duplicate, bad beta target, and project-tag
states. The SSpec invokes that simulator, the live-collector simulator, and the
root-guard simulator, binding every REQ-PPS requirement to executable behavior.
CI attempts it with the exact pinned beta revision. Until
`ormastes/simple#497` supplies a runnable production beta artifact, the three
portable harnesses are executable evidence and beta SSpec execution remains an
explicit blocker, not an accepted substitute.

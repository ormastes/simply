# Project proof receipts

One `<project>.sdn` file may prove one project revision. Absence is intentional:
the Projects page renders it as **unverified**. A receipt is accepted only by
`scripts/project_proof.sh`; do not hand-label a project as working.

Required, unique fields are: `schema=project-proof-v1`, `project`,
`repository`, `branch`, `commit`, `simple_tag`, `simple_commit`,
`simple_binary_sha256`, `simple_version_sha256`, `tree=clean`,
`test_result=verified`, `test_command`, `test_exit=0`, `test_output_sha256`,
`failure_phase`, `sspec_paths`, `sspec_review=basic-static`, `checked_at`, and `follow_up`. The command output digest and
SSpec path make a claim auditable without trusting prose. Any missing,
duplicated, mismatched, or unsafe field renders the project **failed**.
`project_tag` and `project_tag_commit` are optional as a pair; when present,
the resolved tag commit must equal `commit`. A clean, structurally valid
`test_result=failed` receipt records a reproducible failure without causing the
offline renderer itself to fail. Invalid receipts still make it exit nonzero.
`failure_phase` is `none`, `simple-version`, or `project-test`; a runtime
preflight failure is retained as failed evidence rather than disappearing.

`basic-static` rejects missing assertions and known placeholder patterns; it is
not a semantic coverage claim. Generated rows link each SSpec at the exact
project commit and retain `follow_up=manual-semantic-review` so readers and
maintainers can inspect what the passing command actually proves.

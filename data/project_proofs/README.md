# Project proof receipts

One `<project>.sdn` file may prove one project revision. Absence is intentional:
the Projects page renders it as **unverified**. A receipt is accepted only by
`scripts/project_proof.sh`; do not hand-label a project as working.

Required, unique fields are: `schema=project-proof-v1`, `project`,
`repository`, `branch`, `commit`, `simple_tag`, `simple_commit`, `tree=clean`,
`test_result=verified`, `test_command`, `test_exit=0`, `test_output_sha256`,
`sspec_paths`, `checked_at`, and `follow_up`. The command output digest and
SSpec path make a claim auditable without trusting prose. Any missing,
duplicated, mismatched, or unsafe field renders the project **failed**.

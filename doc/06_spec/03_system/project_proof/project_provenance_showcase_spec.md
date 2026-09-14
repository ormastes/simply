# Project provenance showcase

Source: `test/03_system/project_proof/project_provenance_showcase_spec.spl`.

The executable SSpec launches four portable simulators. Together they prove
all receipt states, explicit expiry, canonical checkout/tag/runtime binding,
anti-placeholder SSpec review, output digests, immutable non-proof
observations, private-metadata withholding, strict/pre-commit dirty-root
behavior, and per-run workflow isolation from stale receipts.
The exact beta execution is currently blocked before SSpec parsing by
[`ormastes/simple#497`](https://github.com/ormastes/simple/issues/497); the
portable runs below do not masquerade as beta-runtime evidence.

Run the same underlying evidence directly:

```sh
sh test/project_provenance_showcase_test.sh
sh test/collect_project_proof_test.sh
sh test/worktree_clean_guard_test.sh
sh test/workflow_project_proof_test.sh
```

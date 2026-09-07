# Project provenance showcase

Source: `test/03_system/project_proof/project_provenance_showcase_spec.spl`.

The executable SSpec launches three portable simulators. Together they prove
all receipt states, canonical checkout/tag binding, anti-placeholder SSpec
review, output digests, and strict/pre-commit dirty-root behavior.
The exact beta execution is currently blocked before SSpec parsing by
[`ormastes/simple#497`](https://github.com/ormastes/simple/issues/497); the
portable runs below do not masquerade as beta-runtime evidence.

Run the same underlying evidence directly:

```sh
sh test/project_provenance_showcase_test.sh
sh test/collect_project_proof_test.sh
sh test/worktree_clean_guard_test.sh
```

# CLI

`spipe.js` is a dependency-free Node CLI for inspecting and validating the
SPipe module.

Examples:

```sh
node cli/spipe.js info
node cli/spipe.js experts
node cli/spipe.js doc-root ../..
node cli/spipe.js link-plan ../..
node cli/spipe.js doctor ../..
node cli/spipe.js skill
node cli/spipe.js release-guide
node cli/spipe.js release-capabilities
```

The release commands are read-only. `release-guide` prints the canonical
protected-release process and `release-capabilities` prints the policy schema
and supported planning boundaries, including
`capability.scoped_self_review_guidance=true`. The guide distinguishes the
required `SPipe Self Review Admission` status from GitHub's forbidden author
`APPROVED` review and gives reason-specific retry/remediation guidance.
Provider mutation still requires a unique session, live protected-ref
authority, and explicit approval.

The guarded operational commands each accept exactly one JSON object:
`release-session-plan`, `release-main-fix-discovery-plan`,
`release-beta-backport-plan`, `release-forward-port-plan`,
`release-candidate-plan`, and `release-promotion-plan`. They validate and hash
evidence but never checkout, cherry-pick, build, tag, push, delete, or publish.

Fine-tune process examples:

```sh
node cli/spipe.js fine-tune-guide
node cli/spipe.js fine-tune-init
node cli/spipe.js fine-tune-new-attempt demo "LLM-backed app" app
node cli/spipe.js fine-tune-record-data demo dataset source license "download command" .spipe/cache/dataset checksum
node cli/spipe.js fine-tune-record-model-research demo model license 8192 fit constraints selected
node cli/spipe.js fine-tune-select-model-method demo model revision local provider-fine-tune user retry-base-model
node cli/spipe.js fine-tune-scaffold-training demo provider-fine-tune .spipe/llm-finetune-process/scripts/train_demo.shs
node cli/spipe.js fine-tune-record-verify-loop demo "eval command" "metric=1" "metric>=1" pass accepted none
node cli/spipe.js fine-tune-report demo
```

Requirement selection is explicit:

```sh
node cli/spipe.js fine-tune-options
node cli/spipe.js fine-tune-select-requirements <attempt_id> <feature_option> <nfr_option> <selected_by>
```

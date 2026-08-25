# SPipe LLM Fine-Tune Process

SPipe supports LLM-backed app/server development with a record-first tuning
loop. The shared SPipe project owns the process shape; each host repository
stores concrete attempts under its `.spipe/` directory.

## Loop

1. Research the app/server goal and candidate data.
2. Record data downloads, licenses, checksums, and cache paths.
3. Select requirements and NFRs.
4. Design the app/server architecture and choose the base LLM model.
5. Select the tuning method: retrieval/context update, prompt/tool protocol
   update, provider fine-tune, local LoRA/QLoRA, or full fine-tune.
6. Run the training or provider job and record the exact script/command.
7. Verify quality and performance.
8. If performance is not proper, classify the failure and retry implementation,
   data research, model selection, tuning method selection, or another approach.
9. Before handoff, file any remaining retry, verification, safety, or deployment
   work in the host TODO/feature-request tracker instead of leaving it only in
   chat history.

## Required Evidence

Each attempt record must include:

- research document
- data source and download evidence
- base model and reason
- tuning method
- training script or provider-managed marker
- model artifact or provider model ID
- evaluation command and metrics
- decision and retry target when the attempt is not accepted

## Host State

Recommended host layout:

```text
.spipe/llm-finetune-process/
  attempts/
  attempts.sdn
  models.sdn
  training_scripts.sdn
```

Use `spipe fine-tune-template` to print the attempt template and
`spipe fine-tune-verify <record.sdn>` to run the structural evidence gate.
Use `spipe fine-tune-record-data` to append data-download evidence to the host
registry before training.
Use `spipe fine-tune-data-plan <attempt_id>` to inspect recorded downloads and
cache/checksum checks. Use `spipe fine-tune-record-data-check <attempt_id>
<name> <cache_path> <result> [checksum] [notes]` after each download or
deliberate skip.
Use `spipe fine-tune-init` to create the host registry layout before recording
attempt evidence.
Use `spipe fine-tune-record-process` to link the attempt to research,
requirements, NFR, plan, architecture, and design documents.
Use `spipe fine-tune-scaffold-process-docs <attempt_id> <feature_slug> [title]`
to create starter research, requirement option, NFR option, plan, architecture,
and design docs, then record the process trace.
Use `spipe fine-tune-record-requirements` after the user selects the feature and
NFR option set; SPipe must not infer this selection automatically.
Use `spipe fine-tune-record-model` to append base-model selection evidence and
`spipe fine-tune-record-training` to append tuning script/model artifact
evidence.
Use `spipe fine-tune-scaffold-training <attempt_id> <method> <script_path>
[model_artifact]` to create an executable training script scaffold and record
the script path before the real trainer/provider command is filled in.
Use `spipe fine-tune-record-model-research` to record candidate model research,
license/context constraints, and architecture-use decisions before selecting the
base model.
Use `spipe fine-tune-model-method-options <attempt_id>` to list recorded
candidate model research and supported tuning methods. Use
`spipe fine-tune-select-model-method <attempt_id> <base_model> <revision>
<deployment_target> <method> <selected_by> <fallback> [reason]` to record the
base model and tuning method chosen during design.
Use `spipe fine-tune-record-model-arch` when the selected path is to design a
new model or adapter architecture before tuning.
Use `spipe fine-tune-scaffold-model-arch <attempt_id> <architecture_doc>
<model_family> <data_strategy> <training_strategy> <deployment_target>
<fallback>` to write a model architecture doc scaffold and record it.
Use `spipe fine-tune-record-method` to record why the selected tuning method is
appropriate and what fallback to try when performance is not acceptable.
Use `spipe fine-tune-options` before user selection and
`spipe fine-tune-select-requirements <attempt_id> <feature_option> <nfr_option>
<selected_by> [notes]` after user selection to write final requirement docs,
delete the host option files, and record the selection evidence.
Use `spipe fine-tune-record-eval` and `spipe fine-tune-record-decision` to
record verification results, retry targets, and attempts to try another way when
performance is not acceptable.
Use `spipe fine-tune-record-verify-loop <attempt_id> <eval_command> <metrics>
<target> <result> <status> <retry_target> [next_attempt] [notes]` to record
evaluation plus decision evidence together and create the retry attempt when a
failed status includes `next_attempt`.
Use `spipe fine-tune-create-retry <source_attempt_id> <next_attempt_id> [goal]
[target]` after a failed decision to create the next attempt and record the
retune handoff to that retry attempt.
Use `spipe fine-tune-status <attempt_id>` before handoff to confirm the attempt
has data, model, training, eval, and decision evidence. If a data-check registry
row records a repo-local `.spipe/llm-finetune-process/scripts/*.shs` checker,
status also prints the checker execution state so a present registry row cannot
hide a WARN cache/license gate. Checker paths are resolved under
`.spipe/llm-finetune-process/scripts/`; traversal outside that directory is
reported as a failed unsafe checker path. Status also prints the first
readiness blocker, or `readiness_blocker=none` when the release gate is ready.
Use `spipe fine-tune-doctor <attempt_id>` to check registry evidence,
placeholder values, missing local model artifact or handoff doc paths, and the
target-eval failure reason before treating an attempt as production evidence.
Use `spipe fine-tune-ready <attempt_id>` as the release/training handoff gate;
it fails while requirement selection, model choice, real tuning method, model
artifact, target-reaching eval, accepted decision, or deployable app handoff
evidence remains pending. Local filesystem model artifact paths must exist;
explicit artifact URIs such as `model://...` are treated as provider-managed
artifacts. Local filesystem app handoff doc paths must also exist; explicit doc
URIs are treated as externally managed evidence. A handoff doc path alone is not
ready when the app handoff still says `do not deploy`, license constraints are
pending, safety eval has not run, or deployment evidence is not deployable.
Use `spipe fine-tune-next <attempt_id>` to print the next required phase for an
attempt, including create-attempt, requirements selection, model selection,
tuning method selection, artifact creation, target eval, or acceptance decision.
Use `spipe fine-tune-report <attempt_id>` to print a consolidated attempt
handoff with the attempt record and all registry evidence.
Use `spipe fine-tune-record-app` and `spipe fine-tune-record-retune` to connect
an LLM-backed app/server to the model attempt it used and the next retune
attempt requested by verification. App/server handoff records must include
license/distribution constraints, safety evaluation coverage, and deployment
runtime/memory/latency/fallback evidence.
Use `spipe fine-tune-app-handoff <attempt_id>` to print the app/server handoff,
model, training, evaluation, decision, and retune evidence as a compact
verification artifact.

## Failed Verification Handoff

If an artifact exists but misses the target eval, do not mark the attempt
accepted. Record the eval and a retry decision, create or name the next attempt,
and file concrete TODO/feature-request entries for the remaining work. For
medical or otherwise high-risk models, include safety, license/distribution,
latency/RSS, fallback, and rollback evidence before any production-ready handoff.

## Process Doc Link

SPipe expects `.spipe/doc` to point at the host project's process docs. The
generic default is `doc/llm_process`; a host can override it in
`.spipe/config.sdn` with `host_process_doc: <path>`.

Use `spipe doc-root <host>` to inspect the selected path and
`spipe doc-link <host> [doc-root]` to create or update `.spipe/doc`.

# SPipe LLM Model Research

SPipe model research chooses the base model and explains how the model will be
used by an LLM-backed app/server or by a fine-tune job.

## Required Research

Record these findings before tuning:

- task fit: code generation, tool use, chat, extraction, routing, or domain QA
- deployment target: local runtime, server process, hosted provider, or hybrid
- context length and expected prompt shape
- license and redistribution limits
- data format and tokenizer compatibility
- hardware or provider constraints
- expected tuning method: retrieval/context update, prompt/tool protocol update,
  provider fine-tune, local LoRA/QLoRA, or full fine-tune
- baseline eval command and metrics

## Architecture Decision

The design phase must record:

- base model ID and revision
- why it is suitable for the app/server architecture
- whether the model is used at build time, runtime, or both
- how the app/server will request retuning after verification failures
- fallback plan when the model cannot meet performance or quality targets

Use `spipe fine-tune-scaffold-model-arch <attempt_id> <architecture_doc>
<model_family> <data_strategy> <training_strategy> <deployment_target>
<fallback>` when the chosen path requires a new adapter/model architecture
document. The command writes the document and records it in
`model_architecture.sdn`.

## Retry Classification

Verification routes failures to one of these retry targets:

- `retry-implementation`: app/server code or tool protocol failed
- `retry-data-research`: data source or download quality failed
- `retry-base-model`: the model family is a poor fit
- `retry-tuning-method`: the selected tuning approach is a poor fit
- `try-other-way`: retrieval, prompting, tool changes, or another architecture is
  more appropriate than further tuning

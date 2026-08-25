<!-- llm-process-gen: managed source=codex_mdsoc_architecture_writing_skill source_sha256=4667397c564e608f128591b0fec21d7fef2cf43e5ac41e816f3b4d3f66f8a841 content_sha256=4667397c564e608f128591b0fec21d7fef2cf43e5ac41e816f3b4d3f66f8a841 -->
---
name: mdsoc-architecture-writing
description: Write or refactor layered MDSOC-style architecture docs for this repo, especially for compiler, loader, interpreter, and shared tree-node visibility. Use when the task asks for layers, tree encapsulation, public-to-next-layer rules, common node extraction, or sibling-private/tree-private analysis.
---

# MDSOC Architecture Writing

Use this skill when the task is about describing or reshaping architecture as a layered tree with explicit visibility.

## Outcome

Produce two things together when possible:

1. A current-state map grounded in actual module paths.
2. A to-be MDSOC design with extracted common tree nodes and explicit visibility rules.

## Workflow

1. Read existing architecture docs under `doc/architecture/`.
2. Inspect the real module tree with `rg` and `find`, not assumptions.
3. Identify duplicated structural nodes first.
4. Extract shared, format-level, or contract-level nodes into a common layer before documenting facades.
5. Write the doc with exact repo paths.

## MDSOC Rules For This Repo

- `common` owns contracts, shared formats, stable traits, and cross-layer tree nodes.
- Compiler, loader, and interpreter may consume common nodes directly.
- Sibling layers must not reach into each other's private implementation subtrees.
- If two siblings need the same node, move it upward into a common ancestor or shared layer.
- Frontend grammar stays single-source. Do not add interpreter-only or loader-only grammar forks.

## Required Sections In The Doc

1. Layer list.
2. Tree-level encapsulation per layer.
3. Common relative tree-node paths.
4. Public surface from each layer to the next layer.
5. A matrix with:
   - row = raw layer
   - column = common tree node
   - each populated cell has:
     - public to parent node
     - public to next-layer sibling

## Visibility Model

- Prefer tree-private by default.
- Allow sibling access only through extracted common nodes or explicit facades.
- Treat "public to next layer" as a documented facade, not general visibility.
- Do not invent new grammar keywords unless existing module privacy cannot express the rule.

Read [references/visibility-model.md](references/visibility-model.md) when the task asks whether sibling-private or tree-private grammar is needed.

## Refactor Heuristic

Good extraction targets:
- duplicated file-format structs
- shared symbol/relocation metadata
- common diagnostics and protocol contracts
- loader/compiler/interpreter bridge traits

Bad extraction targets:
- hot-path execution code with different invariants
- backend-specific optimization logic
- convenience helpers used by only one layer

## Output Style

- Prefer one current-state section and one to-be section.
- Use exact paths like `src/compiler_rust/common/src/smf`.
- Call out violations explicitly.
- End with a short migration sequence.

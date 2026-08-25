# Simple Project Expert

## Role

Own project-level process knowledge for the Simple repository and its
subprojects.

## Subprojects

- compiler: `src/compiler`
- app tools: `src/app`
- libraries: `src/lib`
- runtime: `src/runtime`
- SimpleOS: `src/os`, `examples/simple_os`
- examples and external sample submodules: `examples`

## Pipeline

Use SPipe full feature development for cross-cutting work:

- `/sp_dev` for full feature development
- `/spipe` for focused SPipe test/spec authoring
- `/verify` before release

## Update Rule

When a subproject gains its own SPipe module, record its directory, owner,
setup command, and verification command here.

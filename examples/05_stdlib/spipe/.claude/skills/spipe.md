---
name: spipe
description: SPipe Skill — Simple Pipe (spec → test → report). BDD test writing, matchers, file structure, doc generation. Use when writing or editing `*_spec.spl` test files, debugging matcher failures, or scaffolding from `.claude/templates/spipe_template.spl`. Renamed from `sspec` on 2026-04-26.
---

# SPipe — Simple Pipe (spec → test → report)

The canonical skill content lives at:

**[doc/00_llm_process/spipe/skill.md](../../doc/00_llm_process/spipe/skill.md)**

Read that file for full BDD syntax, matchers, file structure, hooks, fixtures,
shared contexts, test types, doc generation, and critical rules.

## Quick references in the same directory

- [`doc/00_llm_process/spipe/INDEX.md`](../../doc/00_llm_process/spipe/INDEX.md) — full migration manifest
- [`doc/00_llm_process/spipe/loop.md`](../../doc/00_llm_process/spipe/loop.md) — `/spipe_loop` continuous-check workflow
- [`doc/00_llm_process/spipe/lint_rules.md`](../../doc/00_llm_process/spipe/lint_rules.md) — lint design
- [`doc/00_llm_process/spipe/guide.md`](../../doc/00_llm_process/spipe/guide.md) — pointer to canonical testing guide

## Template

```
cp .claude/templates/spipe_template.spl test/my_spec.spl
```

## Run

```
bin/simple test path/to/my_spec.spl
```

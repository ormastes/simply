---
name: dev
description: Full feature development via /sstack — intake, research, design, SPipe specs, implementation, refactor, verify, and ship.
---

# Dev Skill — Full Feature Development

`/dev` runs the full SStack feature-development pipeline: intake, research,
architecture/design, SPipe specs, implementation, refactor, verification, and
ship handoff. The SPipe-prefixed alias is `/sp_dev`.

This is separate from `/spipe`, which is the focused BDD/spec-writing skill used
inside the pipeline.

## Usage

```
/dev <description of what to build or fix>
/sp_dev <description of what to build or fix>
```

Argument: `$ARGUMENTS`

## Dispatch

Read `.claude/skills/sstack.md` and execute its full orchestrator procedure
with the user request. No differences — `/dev`, `/sp_dev`, and `/sstack` are
the same full feature-development pipeline.

## When to Use

| Scenario | Use |
|----------|-----|
| Any dev task (bug fix, feature, refactor, TODO) | `/dev`, `/sp_dev`, or `/sstack` |
| BDD/spec authoring only | `/spipe` |
| Large feature needing 15-phase doc artifacts | `/impl` |
| Research only, no implementation | `/research` |
| Design only, implementation later | `/design` |
| Post-implementation verification audit | `/verify` |

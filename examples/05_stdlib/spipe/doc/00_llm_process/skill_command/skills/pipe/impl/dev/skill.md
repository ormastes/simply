<!-- llm-process-gen: managed source=pipe_impl_dev_skill source_sha256=d0df8163a380c2334795d21db3ed31bd11047a2748862fcae048c9696a7e3ec2 content_sha256=d0df8163a380c2334795d21db3ed31bd11047a2748862fcae048c9696a7e3ec2 -->
---
name: dev
description: Deprecated /dev pointer. Use /sp_dev for the SPipe feature-development pipeline.
---

# Dev Skill — Deprecated Pointer

`/dev` is no longer a standalone Codex skill. Use `/sp_dev` for the SPipe
feature-development pipeline.

## Usage

```
/sp_dev <description of what to build or fix>
```

Argument: `$ARGUMENTS`

## Dispatch

Read `.codex/skills/sp_dev/SKILL.md` and execute its orchestrator procedure
with the user request.

## When to Use

| Scenario | Use |
|----------|-----|
| Any dev task (bug fix, feature, refactor, TODO) | `/sp_dev` |
| Large feature needing 15-phase doc artifacts | `/impl` |
| Research only, no implementation | `/research` |
| Design only, implementation later | `/design` |
| Post-implementation verification audit | `/verify` |

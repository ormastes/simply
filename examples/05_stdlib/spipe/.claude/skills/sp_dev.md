---
name: sp_dev
description: SPipe-prefixed full feature development alias for /dev and /sstack.
---

# SP Dev Skill -- Full Feature Development Alias

`/sp_dev` is the SPipe-prefixed alias for `/dev` and `/sstack`. It runs the
full feature-development pipeline: intake, research, architecture/design, SPipe
specs, implementation, refactor, verification, and ship handoff.

Use it when a command surface needs an explicit SPipe/SStack namespace while
keeping the same lifecycle behavior:

```
/sp_dev <description of what to build or fix>
```

Argument: `$ARGUMENTS`

## Dispatch

Read `.claude/skills/sstack.md` and execute its full orchestrator procedure
with the user request. There are no behavioral differences between `/sp_dev`,
`/dev`, and `/sstack`.

---
name: dev
description: "Deprecated /dev pointer. Use /sp_dev for SPipe feature development."
---

# Dev -- Deprecated Pointer

`/dev` is no longer a standalone Codex skill. Use `/sp_dev` for the full SPipe
feature-development pipeline.

Use `/sp_dev` for features, bug fixes, refactors, and TODO implementation that should
move through intake, research, architecture/design, SPipe specs, implementation,
refactor, verification, and ship handoff:

```
/sp_dev <description of what to build or fix>
```

## Dispatch

Follow the current SPipe dev entrypoint in `.codex/skills/sp_dev/SKILL.md`.

Preserve its protected-PR handoff: GitHub forbids author `APPROVED` reviews;
`SPipe Self Review Admission` is a required status check, not provider or
independent approval. Log the exact rejection/invalidation reason and follow
its scoped remediation without reusing stale status or weakening release
authority.

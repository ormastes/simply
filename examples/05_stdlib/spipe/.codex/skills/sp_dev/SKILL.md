---
name: sp_dev
description: "SPipe full feature development entrypoint."
---

# SP Dev -- Full Feature Development

`/sp_dev` runs the full SPipe feature-development pipeline.

Use it when an explicit SPipe namespace is clearer for a feature, bug fix,
refactor, or TODO that should move through intake, research, design, SPipe
specs, implementation, refactor, verification, and ship handoff:

```
/sp_dev <description of what to build or fix>
```

## Dispatch

Follow the current SPipe dev entrypoint in `.codex/skills/sp_dev/SKILL.md`.

## Protected PR self-review handoff

GitHub forbids a PR author `APPROVED` review. `SPipe Self Review Admission` is
a required status check, not provider/independent approval. Ordinary code/text
is default allow absent external deny/constrain through `code`, `text`, exact
`file`, immediate `directory_files`, and recursive `directory_recursive`
scopes. Log the exact rejection/invalidation reason: drift/expiry needs a fresh
exact-head review+dispatch; deny needs policy-owner action or an eligible
independent route; uncovered scope needs a smaller diff/new constraint;
unsafe/secret material must be removed and credentials rotated. Never reuse a
stale status or weaken candidate/release/publication authority.

---
name: sync
description: Fetch, rebase, verify, and push only the current isolated session branch.
---

# Isolated Session Sync

Read
`doc/00_llm_process/skill_command/skills/codex/sync/skill.md` completely and
follow it. Sync only the current session-owned `work/*` branch from its declared
protected target. Verify branch/worktree ownership, rebase only when policy
permits, renew affected evidence, and push only the owned ref with lease/CAS.

Never mutate or rebase a protected ref, candidate, recovery ref, or tag.

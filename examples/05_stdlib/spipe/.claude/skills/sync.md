# Isolated Session Sync

Read `doc/00_llm_process/skill_command/skills/codex/sync/skill.md` completely and
follow its policy-equivalent flow. Sync only the current session-owned `work/*`
branch, verify branch/worktree ownership, rebase only when allowed, renew
affected evidence, and push only that owned ref with lease/CAS. Never mutate or
rebase protected refs, candidates, recovery refs, or tags.

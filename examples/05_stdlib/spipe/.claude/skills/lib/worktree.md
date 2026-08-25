---
name: worktree
description: JJ workspace isolation and parallel working-copy workflow
---

# Worktree Skill -- JJ Workspace Isolation

> Use **jj workspaces** exclusively. DO NOT use `EnterWorktree`/`ExitWorktree` (git worktree tools).

## Lifecycle

```bash
# 1. Create
jj workspace add ../simple-ws-<name> --name ws-<name>

# 2. Work
cd ../simple-ws-<name>    # or use absolute paths from main

# 3. Commit
jj commit -m "feat: <description>"

# 4. Integrate (from main)
jj squash --from <change_id>

# 5. Cleanup
jj workspace forget ws-<name>
rm -rf ../simple-ws-<name>
```

## Quick Reference

| Task | Command |
|------|---------|
| Create | `jj workspace add ../simple-ws-<name> --name ws-<name>` |
| List | `jj workspace list` |
| Update stale | `jj workspace update-stale` |
| Forget | `jj workspace forget ws-<name>` |

## Agent Pattern

1. Main agent creates workspace
2. Task agent works via absolute paths, commits with `jj commit`
3. Main agent integrates: `jj squash --from <change_id>`
4. Main agent cleans up: `forget` + `rm -rf`

Rules: Task agents MUST NOT use `EnterWorktree`/`ExitWorktree`. Only main agent creates/destroys workspaces. Run `jj workspace update-stale` if workspace was idle.

## Troubleshooting

- **Stale**: `jj workspace update-stale`
- **Conflicts**: `jj st` to check, `.sdn` -> `jj resolve --tool=internal:ours`, `.spl` -> manual
- **Orphaned**: `jj workspace list` then `forget` + `rm -rf` unused

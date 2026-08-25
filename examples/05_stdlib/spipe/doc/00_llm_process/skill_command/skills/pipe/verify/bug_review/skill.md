<!-- llm-process-gen: managed source=pipe_verify_bug_review_skill source_sha256=218b67c086c8ae332a245fb58d6b0899aec590499fbf4a3b8684411ac146f28b content_sha256=218b67c086c8ae332a245fb58d6b0899aec590499fbf4a3b8684411ac146f28b -->
---
name: bug_review
description: Unified bug tracking — list, view, triage, fix from GitHub Issues + Jira. Routes to bug sub-skills.
---

# Bug Review Skill — Dispatcher

Unified bug tracking across GitHub Issues and Jira with AI-powered triage and fix.

## Usage

```
/bug_review <command> [args]
```

## Commands

| Command | Example | Description |
|---------|---------|-------------|
| `setup` | `/bug_review setup` | Setup bug tracking integration |
| `list` | `/bug_review list` | List bugs from all sources |
| `view <id>` | `/bug_review view gh#42` | View bug details |
| `search <query>` | `/bug_review search crash` | Search bugs |
| `triage` | `/bug_review triage` | AI-powered bug classification |
| `fix <id>` | `/bug_review fix gh#42` | Analyze bug + propose code fix |
| `triage loop` | `/bug_review triage loop` | Start periodic triage (every 4h) |

## Dispatch Logic

Argument: `$ARGUMENTS`

### Route

**`setup`:**
Read `tools/claude-plugin/repo-and-pull-req/skills/bug/bug_setup.md` and follow.

**`list`:**
Run `bin/bug list` with any extra flags passed through.

**`view <id>`:**
Run `bin/bug view <id>`.

**`search <query>`:**
Run `bin/bug search <query>`.

**`triage`:**
Read and follow `tools/claude-plugin/repo-and-pull-req/skills/bug/bug_review.md` (AI-powered analysis).

**`fix <id>`:**
Read and follow `tools/claude-plugin/repo-and-pull-req/skills/bug/bug_fix.md`.

**`triage loop`:**
Start scheduled triage: `/schedule 4h /bug_review triage`

## Prerequisite Checks

- `bin/bug version` — CLI available
- For GitHub: `gh auth status`
- For Jira: `bin/jira auth status` (optional)

## Integration

| Skill | When Used |
|-------|-----------|
| `/repo_and_pull_req push` | After fixing a bug, create PR |
| `/repo_and_pull_req review` | Review the fix PR |

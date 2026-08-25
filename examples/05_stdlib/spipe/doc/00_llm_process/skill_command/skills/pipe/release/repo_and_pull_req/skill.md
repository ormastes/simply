<!-- llm-process-gen: managed source=pipe_release_repo_and_pull_req_skill source_sha256=b0d8ff77e62a1f146b0cb5f61c09a80186698ae2321053ec11daaaa8f3ce8c45 content_sha256=b0d8ff77e62a1f146b0cb5f61c09a80186698ae2321053ec11daaaa8f3ce8c45 -->
---
name: repo_and_pull_req
description: GitHub and Jira/Confluence integration — setup, push, wiki, and autonomous PR review. Routes to sub-skills in git/ and jira/ directories.
---

# Repo & Pull Request Skill — Dispatcher

Unified skill for GitHub and Jira/Confluence operations: setup, push, wiki, and PR review.

## Usage

```
/repo_and_pull_req <command> [platform] [args]
```

## Commands

| Command | Example | Description |
|---------|---------|-------------|
| `setup gh` | `/repo_and_pull_req setup gh` | Install and configure gh CLI |
| `setup jira` | `/repo_and_pull_req setup jira` | Install and configure jira-cli + Atlassian account |
| `push` | `/repo_and_pull_req push` | Push code as PR + create Jira issue |
| `wiki gh` | `/repo_and_pull_req wiki gh` | Create/update GitHub wiki page |
| `wiki jira` | `/repo_and_pull_req wiki jira` | Create/update Confluence page |
| `wiki` | `/repo_and_pull_req wiki` | Update both wikis |
| `review <pr#>` | `/repo_and_pull_req review 42` | Single-pass PR review |
| `review loop <pr#>` | `/repo_and_pull_req review loop 42` | Start hourly review loop |
| `review stop <pr#>` | `/repo_and_pull_req review stop 42` | Stop review loop |

## Dispatch Logic

Argument: `$ARGUMENTS`

### Parse

Split `$ARGUMENTS` into tokens:
1. First token = command (`setup`, `push`, `wiki`, `review`)
2. Second token = platform or sub-command (`gh`, `jira`, `loop`, `stop`, `<pr#>`)
3. Remaining = extra arguments

### Route

**`setup gh`:**
Read `tools/claude-plugin/repo-and-pull-req/skills/git/gh_setup.md` and follow procedure.

**`setup jira`:**
Read `tools/claude-plugin/repo-and-pull-req/skills/jira/jira_setup.md` and follow procedure.

**`push`:**
1. Pre-check: `gh auth status` — if fails, redirect to `setup gh`
2. Read and follow `tools/claude-plugin/repo-and-pull-req/skills/git/gh_push.md`
3. If Jira configured (`bin/jira auth status` succeeds):
   Also read and follow `tools/claude-plugin/repo-and-pull-req/skills/jira/jira_push.md`

**`wiki gh`:**
Read `tools/claude-plugin/repo-and-pull-req/skills/git/gh_wiki.md` and follow procedure.

**`wiki jira`:**
Read `tools/claude-plugin/repo-and-pull-req/skills/jira/jira_wiki.md` and follow procedure.

**`wiki`** (no platform specified):
Run `wiki gh`. If Jira configured (`bin/jira auth status` succeeds), also run `wiki jira`.

**`review <pr#>`:**
1. Read and follow `tools/claude-plugin/repo-and-pull-req/skills/git/gh_pull_req_review.md`
2. If Jira configured, also follow `tools/claude-plugin/repo-and-pull-req/skills/jira/jira_pull_req_review.md`

**`review loop <pr#>`:**
Start scheduled hourly review:
```
/schedule 1h /repo_and_pull_req review <pr#>
```

**`review stop <pr#>`:**
Cancel the scheduled review for this PR number.

## Prerequisite Checks

Before any non-setup command:
- For gh commands: `gh auth status` — redirect to `setup gh` if fails
- For jira commands: `bin/jira auth status` — redirect to `setup jira` if fails
- For push: verify committed changes exist (`jj st`)

## Integration

| Skill | When Used |
|-------|-----------|
| `/sync` | File count guards during push and rebase |
| `/release` | Suggested after merge for version bump |
| `/sstack` | State file used for richer PR descriptions |

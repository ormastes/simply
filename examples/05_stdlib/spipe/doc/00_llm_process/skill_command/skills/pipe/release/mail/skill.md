<!-- llm-process-gen: managed source=pipe_release_mail_skill source_sha256=591224c14d6a2bdc7e13ca4cca95e42e5ec36f333972905f0e5db36e38784315 content_sha256=591224c14d6a2bdc7e13ca4cca95e42e5ec36f333972905f0e5db36e38784315 -->
---
name: mail
description: Shell-based email client — Gmail-like CLI for IMAP/SMTP. Supports Gmail, Outlook, Yahoo, ProtonMail, Fastmail. Routes to mail sub-skills.
---

# Mail Skill — Dispatcher

Shell-based email client mirroring the gh/jira CLI interface. Supports multiple providers via IMAP/SMTP.

## Usage

```
/mail <command> [args]
```

## Commands

| Command | Example | Description |
|---------|---------|-------------|
| `setup` | `/mail setup` | Setup email account |
| `inbox` | `/mail inbox` | List inbox messages |
| `read <uid>` | `/mail read 123` | Read a message |
| `send` | `/mail send` | Compose and send email |
| `reply <uid>` | `/mail reply 123` | Reply to a message |
| `search <query>` | `/mail search "PR"` | Search messages |
| `review` | `/mail review` | Review PR notification emails |
| `notify <pr#>` | `/mail notify 42` | Send PR notification email |

## Dispatch Logic

Argument: `$ARGUMENTS`

### Route

**`setup`:**
Read `tools/claude-plugin/repo-and-pull-req/skills/mail/mail_setup.md` and follow.

**`inbox`:**
Run `bin/mail inbox` with any extra flags.

**`read <uid>`:**
Run `bin/mail read <uid>`.

**`send`:**
Read and follow `tools/claude-plugin/repo-and-pull-req/skills/mail/mail_send.md`.

**`reply <uid>`:**
Run `bin/mail reply <uid>` (or follow mail_send.md for AI-assisted reply).

**`search <query>`:**
Run `bin/mail search <query>`.

**`review`:**
Read and follow `tools/claude-plugin/repo-and-pull-req/skills/mail/mail_review.md`.

**`notify <pr#>`:**
Read and follow `tools/claude-plugin/repo-and-pull-req/skills/mail/mail_notify.md`.

## Prerequisite Checks

- `bin/mail version` — CLI available
- `bin/mail auth status` — account configured
- For PR notifications: `gh auth status`

## Integration

| Skill | When Used |
|-------|-----------|
| `/repo_and_pull_req push` | Trigger mail notification on new PR |
| `/repo_and_pull_req review` | Send/receive review updates via email |
| `/bug_review` | Notify about triaged bugs via email |

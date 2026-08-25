---
name: spipe_loop
description: SPipe Loop — periodic check-and-implement plus daily-debug ingest pipeline.
---

# SPipe Loop Skill

`spipe_loop` runs SPipe orchestrator cycles. It supports two modes:

1. **Default (continuous-check)** — periodic poll of in-flight tracks.
   **NOT YET IMPLEMENTED.** Invoking `/spipe_loop` without `--daily-debug` must
   print "spipe_loop: default continuous-check mode is not yet implemented.
   Use /spipe_loop --daily-debug instead." and exit immediately. Do NOT
   attempt to improvise behavior or loop.
2. **`--daily-debug`** — once-a-day ingest of the engineering bug-report
   inbox (this file). Drives the 7-step pipeline below.

## Usage

```
/spipe_loop                  # NOT YET IMPLEMENTED — exits with message
/spipe_loop --daily-debug    # run the daily-debug pipeline once
/spipe_loop --daily-debug --quiet     # suppress notify step
/spipe_loop --daily-debug --dry-run   # plan only, no I/O writes
```

## `--daily-debug` Mode — 7-Step Pipeline

> Source: derived from issue #10 task spec. Will be reconciled with
> `doc/05_design/spipe_infra_arch.md` §"Daily Debug Analysis" once that
> doc lands (Agent A).

| # | Step | Driver call | Side effects |
|---|------|-------------|--------------|
| 1 | Load watermark | read `~/.config/itf/spipe_daily.sdn` key `last_run` (ISO 8601). Default = now − 24h on first run. | none |
| 2 | List inbox since watermark | `outlook_list_messages(folder=Inbox, filter="receivedDateTime ge {last_run}")` via `adapter_outlook.spl` (Agent A/B). | network read |
| 3 | Per-message extract | regex `[A-Z][A-Z0-9]+-\d+` for Jira keys; regex `https?://[^/]+/[^/]+/[^\s]+` for MinIO URLs. | none |
| 4 | Triage classify | by URL extension: `.bin/.elf/.hex` → `fw`; `.dmp/.core/.crash` → `dump`; `.log/.txt/.md` → `note`; else `unknown`. | none |
| 5 | Write daily digest | `doc/08_tracking/debug/YYYY-MM-DD.md` — summary table + per-bug section. Skipped under `--dry-run`. | file write |
| 6 | Save watermark | atomic tmp + rename, mode 0600, key `last_run = <ISO 8601 now>`. Skipped under `--dry-run`. | file write |
| 7 | Notify | print summary line + invoke `/mail notify` for any S0/S1. Skipped under `--quiet` or `--dry-run`. | stdout / mail |

## Driver

The pipeline is implemented in `src/app/itf/cmd_daily_debug.spl::run_daily_debug`.
The skill just routes:

```
bin/itf daily-debug [--quiet] [--dry-run]
```

## Flags

| Flag | Effect |
|------|--------|
| `--daily-debug` | Select the daily-debug mode (otherwise: default continuous-check stub) |
| `--quiet` | Suppress step 7 (notify); steps 1–6 still run |
| `--dry-run` | Print the plan only; no `file_write_text`, no watermark save, no mail |

## Prerequisite Checks

Before `--daily-debug` runs:
- `bin/mail auth status` — Outlook account configured.
- `bin/itf jira auth status` — Jira read access (used by step 3 for resolving keys).
- `bin/itf minio status` — required only when downstream skills (`fw`/`dump`/`notes`)
  are invoked; the daily-debug pipeline itself only records URLs.

## Integration

| Skill | When Used |
|-------|-----------|
| `/company_bug_report ingest` | Top-level entry-point that delegates here |
| `/mail` | Step 2 (inbox list) and step 7 (notify) |
| `/bug_review` | Triaged bugs in the digest are linked back to `/bug_review view <id>` |

## Notes

- The default (continuous-check) mode is a stub here. TODO: Agent A/B will
  fill it in when the orchestrator lands.
- The 7-step list above is authoritative until the arch doc reconciles it.
- All file writes are gated on `not dry_run` in the driver, so a failing
  unit test for `--dry-run` will catch any drift.

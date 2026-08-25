# SStack Dashboard Integration

SStack emits JSONL events that the LLM Agent Dashboard (`JsonlWatcher` + `AgentDashboardStore`) consumes to visualize orchestrator activity in the room grid.

---

## Quick Start

```bash
# 1. Start the orchestrator (emits events directly)
scripts/sstack-orchestrator.shs &

# 2. Optionally start the bridge for richer state-transition events
scripts/sstack-dashboard-bridge.shs &

# 3. Launch the dashboard
bin/simple llm-dashboard --dir .agent/events --gui --port 3001
```

Open `http://localhost:3001` to see SStack agents in the room grid.

---

## Event File

All JSONL events are appended to:

```
.agent/events/sstack.jsonl
```

The dashboard's `JsonlWatcher` monitors this directory and feeds new lines into `AgentDashboardStore`.

---

## Event Format Reference

Events follow the `ActivityEntry` schema expected by the dashboard.

### task_start

Emitted when the orchestrator picks up a new task.

```json
{"type":"task_start","agent_id":"sstack-orchestrator","status":"working","task":"implement actor timeout","tasks_remaining":5,"role":"Engineer","timestamp":"2026-04-05T03:00:00Z"}
```

### agent_status

Emitted on state transitions (working, idle, sleeping, crashed).

```json
{"type":"agent_status","agent_id":"sstack-orchestrator","status":"working","task":"implement actor timeout","phase":"5-implement","role":"Engineer","timestamp":"2026-04-05T03:00:05Z"}
```

### phase_start

Emitted when the orchestrator enters a named SStack phase.

```json
{"type":"phase_start","agent_id":"sstack-orchestrator","task":"implement actor timeout","phase":"5-implement","role":"Engineer","timestamp":"2026-04-05T03:01:00Z"}
```

### phase_complete

Emitted when a phase finishes.

```json
{"type":"phase_complete","agent_id":"sstack-phase-4","phase":"spec","role":"QA Lead","specs_created":5,"timestamp":"2026-04-05T03:02:00Z"}
```

### task_complete

Emitted when a task finishes successfully.

```json
{"type":"task_complete","agent_id":"sstack-orchestrator","task":"implement actor timeout","duration_sec":120,"tasks_remaining":4,"role":"Engineer","timestamp":"2026-04-05T03:05:00Z"}
```

### task_failed

Emitted when a task fails.

```json
{"type":"task_failed","agent_id":"sstack-orchestrator","task":"implement actor timeout","duration_sec":45,"exit_code":1,"role":"Engineer","timestamp":"2026-04-05T03:05:00Z"}
```

### bridge_start

Emitted when the dashboard bridge process starts.

```json
{"type":"bridge_start","agent_id":"sstack-bridge","role":"Bridge","timestamp":"2026-04-05T03:00:00Z"}
```

---

## Architecture

```
sstack-orchestrator.shs
  |-- writes STATUS.json
  |-- emits events -> .agent/events/sstack.jsonl  (direct)
  |
sstack-dashboard-bridge.shs  (optional, richer transitions)
  |-- watches STATUS.json
  |-- emits events -> .agent/events/sstack.jsonl  (state diffs)
  |
LLM Agent Dashboard
  |-- JsonlWatcher monitors .agent/events/
  |-- AgentDashboardStore ingests ActivityEntry lines
  |-- Room grid renders agent cards
```

### Two Emission Sources

1. **Direct (orchestrator):** `emit_event` calls in `sstack-orchestrator.sh` at task start, phase start, task complete, and task failure. Lightweight, always available.

2. **Bridge (optional):** `sstack-dashboard-bridge.sh` polls `STATUS.json` every 2 seconds and emits richer transition events (idle->working, working->idle, working->crashed). Run alongside the orchestrator for full state visibility.

Both write to the same JSONL file. Events are append-only and idempotent for the dashboard.

---

## Viewing SStack Agents in the Room Grid

The dashboard renders one card per unique `agent_id`. SStack uses:

| agent_id | Description |
|----------|-------------|
| `sstack-orchestrator` | Main orchestrator loop |
| `sstack-bridge` | Dashboard bridge process |
| `sstack` | Generic events from direct emission |

Each card shows:
- Current status (working / idle / sleeping / crashed)
- Active task description
- Current phase
- Role assignment
- Last activity timestamp

---

## Customization

### Change poll interval (bridge)

Edit `POLL_INTERVAL` in `scripts/sstack-dashboard-bridge.sh` (default: 2 seconds).

### Change dashboard port

```bash
bin/simple llm-dashboard --dir .agent/events --gui --port 8080
```

### Filter to SStack events only

The dashboard can filter by `agent_id` prefix in the UI room grid.

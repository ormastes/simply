<!-- llm-process-gen: managed source=pipe_impl_sstack_skill source_sha256=18d16a12ffb4c4cab1582f0bdc44e85660433a64a71fe38e63743698ed5571b1 content_sha256=18d16a12ffb4c4cab1582f0bdc44e85660433a64a71fe38e63743698ed5571b1 -->
---
name: sstack
description: Legacy SStack 8-phase BDD/TDD pipeline orchestrator with cooperative workflow (Codex/Gemini fallback). Prefer /sp_dev for current dev work.
---

# SStack Skill -- Superpowers + GSD + GStack Orchestrator

SStack is a full-lifecycle development pipeline that combines three frameworks:
- **Superpowers** -- BDD/TDD: spec-first, test-first, refactor
- **GSD** -- Sub-40% context budget per phase, fresh orchestrators, local state files
- **GStack** -- Specialized role agents, data flow pipeline, quality gates

## Invocation

```
/sstack <user request>
```

For current feature development, prefer `/sp_dev`. `/dev` is no longer a
standalone Codex skill.

## How It Works

1. You (the orchestrator) run Phase 1 **inline** to refine the user request
2. For Phases 2-8, you spawn a **fresh Agent** per phase (GSD: fresh context)
3. Each agent reads `.sstack/<feature>/state.md`, does its work, writes updated state
4. After each agent returns, you read the state file and verify exit criteria
5. If exit criteria fail, re-run the phase (max 2 retries)

## Pipeline

| # | Phase | Role | Agent Definition | Cooperative Skill |
|---|-------|------|-----------------|-------------------|
| 1 | dev | Developer Lead | `.claude/agents/spipe/dev.md` | (inline) |
| 2 | research | Analyst | `.claude/agents/spipe/research.md` | `/research` + `/research_codex` |
| 3 | arch | Architect | `.claude/agents/spipe/arch.md` | `/design` + `/gemini_ui_design` |
| 4 | spec | QA Lead | `.claude/agents/spipe/spec.md` | `/spipe` |
| 5 | implement | Engineer | `.claude/agents/spipe/implement.md` | `/coding` |
| 6 | refactor | Tech Lead | `.claude/agents/spipe/refactor.md` | `/refactor` |
| 7 | verify | QA | `.claude/agents/spipe/verify.md` | `/verify` |
| 8 | ship | Release Mgr | `.claude/agents/spipe/ship.md` | `/sync` |

## Cooperative Workflow Integration

SStack phases map to the multi-LLM cooperative pipeline. Each phase tries the full cooperative chain first, then falls back to Claude-solo if external providers are unavailable.

```
Phase 2: Claude /research  →  Codex /research_codex  →  (merge)
Phase 3: Gemini /gemini_ui_design  →  Codex $design (arch)  →  Claude /design (quality)
```

### Availability Detection & Fallback

Before each phase that uses cooperative skills, the orchestrator checks availability:

| Provider | Check | Fallback |
|----------|-------|----------|
| **Codex** | `/codex:setup` or check `codex` CLI exists | Claude handles research/design solo |
| **Gemini** | Check `gemini` CLI or extension exists | Claude handles UI design solo |

**Fallback behavior:**
1. **Available** — Delegate to the cooperative skill as normal
2. **Unavailable** — Log a notification in the state file: `> [!NOTE] Codex unavailable — Claude handling research solo`
3. **Quota exceeded** — Same as unavailable; log: `> [!NOTE] Codex quota exceeded — falling back to Claude solo`
4. Continue the phase with Claude doing the work that would have been delegated

The pipeline **never blocks** on missing providers. Every phase is self-sufficient with Claude alone.

### Per-Phase Cooperative Dispatch

**Phase 2 (research):**
1. Claude runs `/research` (local + domain search)
2. If Codex available: run `/research_codex` for forked agent research + requirement selection
3. Merge findings into state file
4. If Codex unavailable: Claude completes full research solo, note in state file

**Phase 3 (arch):**
1. If Gemini available: run `/gemini_ui_design` for TUI/GUI design (if task has UI)
2. If Codex available: Codex `$design` for architecture
3. Claude runs `/design` for quality review and final architecture
4. If Gemini/Codex unavailable: Claude handles all design solo, note in state file

**Phases 4-8:** Claude-native skills only (`/spipe`, `/coding`, `/refactor`, `/verify`, `/sync`). No external provider dependency.

## Orchestrator Procedure

### Step 0: Setup

1. Derive `<feature>` slug from the user request (lowercase, hyphens, e.g. `add-csv-export`)
2. Create directory `.sstack/<feature>/`
3. Create `.sstack/<feature>/state.md` with the initial template (see State File Format below)

### Step 1: Dev (inline -- do NOT spawn agent)

Run Phase 1 yourself:

1. Read the user request carefully
2. Categorize the task type: `feature`, `bug`, `todo`, or `code-quality`
3. Refine it into a clear, actionable, testable goal
4. Define 3-7 acceptance criteria (AC-1, AC-2, ...)
5. Write the task type, refined goal, and ACs into the state file under `## Task Type`, `## Refined Goal`, and `## Acceptance Criteria`
6. Mark `1-dev` as done in the phase checklist with today's date
7. Write a summary under `## Phase Outputs / ### 1-dev`
8. **Ask the user to confirm** the refined goal and ACs before proceeding

### Steps 2-8: Agent Phases

For each phase N (2 through 8):

1. **Check cooperative availability** (Phase 2-3 only): detect Codex/Gemini. If unavailable, note fallback in state file
2. **Read** `.sstack/<feature>/state.md` to get current state
3. **Read** the phase definitions from `.claude/skills/lib/sstack_phases.md` for phase N's entry/exit criteria
4. **Verify entry criteria** -- if the previous phase output is missing or incomplete, re-run the previous phase
5. **Spawn a fresh Agent** with this prompt:

```
Read .claude/agents/spipe/<phase-name>.md and follow its instructions.

State file: .sstack/<feature>/state.md
Feature: <feature>
Phase: <N>-<phase-name>
Cooperative: <available providers or "solo">

Read the state file, perform your role, then update the state file with:
- Your output summary under ## Phase Outputs / ### <N>-<phase-name>
- Mark your phase done in ## Phase Checklist
- Ensure exit criteria from .claude/skills/lib/sstack_phases.md are met
```

6. **After agent returns**, read `.sstack/<feature>/state.md`
7. **Verify exit criteria** for phase N (from sstack_phases.md)
8. If exit criteria fail: re-run the agent (max 2 retries), then escalate to user
9. Proceed to next phase

### Completion

After Phase 8 (ship) succeeds:
1. Read the final state file
2. Report to the user: refined goal, all ACs checked, summary of each phase output
3. Note any ACs that were not fully met
4. Note which cooperative providers were used vs. solo fallback

## State File Format

Create `.sstack/<feature>/state.md` with this template:

```markdown
# SStack State: <feature>

## User Request
> <original user request verbatim>

## Refined Goal
> <refined user request -- clear, actionable, testable>

## Acceptance Criteria
- [ ] AC-1: ...
- [ ] AC-2: ...
- [ ] AC-3: ...

## Cooperative Providers
- Codex: <available | unavailable | quota-exceeded>
- Gemini: <available | unavailable | quota-exceeded>

## Phase Checklist
- [ ] 1-dev (Developer Lead)
- [ ] 2-research (Analyst)
- [ ] 3-arch (Architect)
- [ ] 4-spec (QA Lead)
- [ ] 5-implement (Engineer)
- [ ] 6-refactor (Tech Lead)
- [ ] 7-verify (QA)
- [ ] 8-ship (Release Mgr)

## Phase Outputs

### 1-dev
<pending>

### 2-research
<pending>

### 3-arch
<pending>

### 4-spec
<pending>

### 5-implement
<pending>

### 6-refactor
<pending>

### 7-verify
<pending>

### 8-ship
<pending>
```

## GSD Budget Rule

Each agent phase must stay under **40% context window usage**. The orchestrator (you) should:
- Keep your own context lean -- delegate, do not accumulate
- Never paste full file contents into agent prompts; point agents to file paths
- If a phase is too large, split it into sub-phases within the same agent call

## Quality Gates

Between every phase transition, verify:
1. State file has the phase marked done with a date
2. Phase output section is non-empty and substantive
3. Exit criteria from `sstack_phases.md` are satisfied
4. No regression -- previous phase outputs are still intact in the state file

## Autonomous Mode

SStack can run autonomously via `scripts/sstack-orchestrator.shs`.
- Reads tasks from `.sstack/TASKS.md`
- Runs full pipeline for each task
- Monitor: `scripts/sstack-monitor.shs`
- Status: `.agent/STATUS.json`

## Language Dispatch

The orchestrator detects the target language from:
1. File extensions in the task description
2. Project structure (Cargo.toml → Rust, package.json → TypeScript, etc.)
3. Explicit `[lang:rust]` tag in task

Language agents: `.claude/agents/lang/<lang>.md`
Supported: simple, c_cpp, rust, python, typescript, go

When spawning Phase 5 (implement) or Phase 6 (refactor), include:
"Read .claude/agents/lang/<detected_lang>.md for language-specific rules"

## Integration with Existing Skills

SStack agents invoke existing skills per phase:
- Phase 2 (research): `/research` + `/research_codex` (if Codex available)
- Phase 3 (arch): `/design` + `/gemini_ui_design` (if Gemini available)
- Phase 4 (spec): `/spipe` for test structure
- Phase 5 (implement): `/coding` rules
- Phase 6 (refactor): `/refactor` checklist
- Phase 7 (verify): `/verify` checklist
- Phase 8 (ship): `/sync` for VCS and `/release` for versioning

## Relationship to Other Workflows

| Workflow | Relationship |
|----------|-------------|
| `/sp_dev` | Current SPipe feature-development entrypoint |
| `/impl` | 15-phase heavyweight workflow — generates doc artifacts, uses agent teams. Independent of sstack but shares skill references (`/coding`, `/spipe`, `/verify`) |
| `/research` | Standalone research skill — used within sstack Phase 2, also runs independently |
| `/research_codex` | Codex cooperative research — used within sstack Phase 2 when Codex available |
| `/gemini_ui_design` | Gemini UI design — used within sstack Phase 3 when Gemini available |
| `/design` | Standalone design skill — used within sstack Phase 3, also runs independently |
| `/verify` | Standalone verification — used within sstack Phase 7, also runs independently |

**Self-sufficient:** Every phase works with Claude alone. Codex and Gemini enrich the pipeline when available but are never required.

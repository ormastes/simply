# SStack Phase Definitions

Reference for all 8 SStack phases. Each phase has: role, focus, entry criteria, exit criteria, context budget, and key actions.

---

## Phase 1: Dev

| Field | Value |
|-------|-------|
| **Role** | Developer Lead |
| **Agent** | `.claude/agents/spipe/dev.md` |
| **Focus** | Analyze the task, categorize it, and refine into a testable goal with acceptance criteria |
| **Context Budget** | 10% (runs inline in orchestrator) |

**Entry Criteria:**
- User request is available

**Actions:**
1. Parse the user request for intent, scope, and constraints
2. Categorize the task type: `feature`, `bug`, `todo`, or `code-quality`
3. Identify ambiguities and resolve them (ask user if needed)
4. Write a refined goal: one sentence, actionable, testable
5. Define 3-7 acceptance criteria (each must be independently verifiable)
6. Identify the feature slug for state file naming

**Exit Criteria:**
- `## Task Type` is one of: `feature`, `bug`, `todo`, `code-quality`
- `## Refined Goal` is a single clear sentence
- `## Acceptance Criteria` has 3-7 items, each with `AC-N:` prefix
- All ACs are testable (can be verified as pass/fail)
- User has confirmed the goal and ACs

---

## Phase 2: Research

| Field | Value |
|-------|-------|
| **Role** | Analyst |
| **Agent** | `.claude/agents/spipe/research.md` |
| **Focus** | Gather all information needed to make architectural and implementation decisions |
| **Context Budget** | 35% |

**Entry Criteria:**
- Phase 1 complete: refined goal and ACs exist in state file

**Actions:**
1. Search existing codebase for related code, patterns, and prior work
2. Identify reusable components, modules, and utilities
3. Find related tests, specs, and documentation
4. Note constraints: runtime limitations, language restrictions (from CLAUDE.md)
5. Identify risks and unknowns
6. Summarize findings as a structured research brief

**Exit Criteria:**
- Research summary covers: related code (with file paths), reusable components, constraints, risks
- At least 3 specific file paths referenced from codebase exploration
- Risks section is non-empty (even if "no significant risks identified")
- Summary is under 200 lines

---

## Phase 3: Architecture

| Field | Value |
|-------|-------|
| **Role** | Architect |
| **Agent** | `.claude/agents/spipe/arch.md` |
| **Focus** | Define the structural design: modules, interfaces, data flow |
| **Context Budget** | 30% |

**Entry Criteria:**
- Phase 2 complete: research summary exists with file paths and constraints

**Actions:**
1. Read research findings from state file
2. Define module structure: which files to create/modify, where they live
3. Define key interfaces: function signatures, class structures, trait boundaries
4. Define data flow: input -> processing -> output
5. Identify integration points with existing code
6. Choose patterns appropriate to the Simple language (no inheritance, composition preferred)

**Exit Criteria:**
- Module list with file paths (new and modified)
- At least one interface definition (function signature or class structure)
- Data flow description (can be textual, does not need diagrams)
- No inheritance used (composition, traits, or mixins only)
- Architecture fits within existing project structure conventions

---

## Phase 4: Spec

| Field | Value |
|-------|-------|
| **Role** | QA Lead |
| **Agent** | `.claude/agents/spipe/spec.md` |
| **Focus** | Write BDD specs and test skeletons BEFORE implementation (Superpowers: spec-first) |
| **Context Budget** | 30% |

**Entry Criteria:**
- Phase 3 complete: architecture with module list and interfaces exists

**Actions:**
1. Read architecture and ACs from state file
2. Create SPipe test file(s) following `/spipe` conventions
3. Write `describe`/`it` blocks covering every AC
4. Include edge cases and error paths
5. Tests should be runnable but FAILING (red phase of TDD)
6. Add `# @cover src/path/to/impl.spl` coverage markers

**Exit Criteria:**
- At least one `.spl` spec file created in `test/`
- Every AC has at least one corresponding `it` block
- Spec file(s) follow SPipe format (describe/it/expect with built-in matchers only)
- Tests reference implementation files that will be created in Phase 5
- Coverage markers present

---

## Phase 5: Implement

| Field | Value |
|-------|-------|
| **Role** | Engineer |
| **Agent** | `.claude/agents/spipe/implement.md` |
| **Focus** | Write the minimum code to make all specs pass (Superpowers: test-first, green phase) |
| **Context Budget** | 40% |

**Entry Criteria:**
- Phase 4 complete: spec files exist with failing tests

**Actions:**
1. Read architecture and spec files from state file
2. Implement each module listed in architecture
3. Follow `/coding` rules (Simple language, `.spl` files, no Python/Bash)
4. Write minimum code to satisfy each spec -- no gold-plating
5. Run tests to verify they pass (or note which need compiled mode)
6. Update state file with list of created/modified files

**Exit Criteria:**
- All files listed in architecture are created/modified
- Code follows Simple language conventions (see CLAUDE.md)
- No unused code, no over-engineering
- Implementation addresses every AC
- File list with paths recorded in phase output

---

## Phase 6: Refactor

| Field | Value |
|-------|-------|
| **Role** | Tech Lead |
| **Agent** | `.claude/agents/spipe/refactor.md` |
| **Focus** | Clean up implementation without changing behavior (Superpowers: refactor phase) |
| **Context Budget** | 30% |

**Entry Criteria:**
- Phase 5 complete: implementation files exist, tests pass (or are expected to pass)

**Actions:**
1. Read implementation file list from state file
2. Check for duplication (within new code and against existing codebase)
3. Check for files exceeding 800 lines -- split if needed
4. Verify naming conventions and code style
5. Remove any dead code, unused imports, or placeholder stubs
6. Ensure TODOs are either implemented or left as TODO (never converted to NOTE)
7. Run the Simple linter: `bin/simple lint <changed .spl files>`

**Exit Criteria:**
- No file exceeds 800 lines
- No duplicated logic (within feature or against existing code)
- No dead code or unused imports
- All TODOs are genuine (not disguised NOTEs)
- Code style consistent with project conventions

---

## Phase 7: Verify

| Field | Value |
|-------|-------|
| **Role** | QA |
| **Agent** | `.claude/agents/spipe/verify.md` |
| **Focus** | Full verification: tests pass, ACs met, no regressions |
| **Context Budget** | 35% |

**Entry Criteria:**
- Phase 6 complete: refactored code with no style issues

**Actions:**
1. Run the spec files created in Phase 4
2. Run the full test suite to check for regressions: `bin/simple test`
3. Verify each AC from the state file against actual implementation
4. Check that all spec `it` blocks have corresponding implementation
5. Mark ACs as checked in the state file
6. If any test fails, document the failure and note whether it needs Phase 5 re-run

**Exit Criteria:**
- All spec tests pass (or documented reason for interpreter-mode limitation)
- No regressions in existing tests
- Every AC is marked as verified with evidence
- If any AC cannot be verified, it is documented with a clear reason

---

## Phase 8: Ship

| Field | Value |
|-------|-------|
| **Role** | Release Manager |
| **Agent** | `.claude/agents/spipe/ship.md` |
| **Focus** | Commit, sync, and close out the feature |
| **Context Budget** | 15% |

**Entry Criteria:**
- Phase 7 complete: all tests pass, all ACs verified

**Actions:**
1. Review the full state file for completeness
2. Commit changes using jj (per CLAUDE.md VCS rules): `jj commit -m "<message>"`
3. Update any tracking docs if applicable (TODO scan, bug reports)
4. Write final summary in state file
5. Mark Phase 8 complete in checklist

**Exit Criteria:**
- All changes committed (jj, not git branch)
- Commit message references the feature
- State file phase checklist is fully checked
- Final summary written under `### 8-ship`
- No uncommitted changes remain

---

## Quality Gate Protocol

The orchestrator enforces quality gates between every phase:

1. **Read** the state file after agent completes
2. **Check** the phase's exit criteria (listed above)
3. **Pass** -- proceed to next phase
4. **Fail** -- re-run the agent with a note about what was missing (max 2 retries)
5. **Hard fail** -- after 2 retries, escalate to user with details of what is blocked

Gate failures are recorded in the state file under the phase output section.

---

## Context Budget Summary

| Phase | Budget | Rationale |
|-------|--------|-----------|
| 1-dev | 10% | Task analysis + refinement, runs inline |
| 2-research | 35% | Broad codebase search |
| 3-arch | 30% | Design decisions with research context |
| 4-spec | 30% | Test writing with architecture context |
| 5-implement | 40% | Largest phase: code + test verification |
| 6-refactor | 30% | Code review and cleanup |
| 7-verify | 35% | Full test run + AC verification |
| 8-ship | 15% | VCS operations only |

Each phase runs in a **fresh agent context** (GSD principle). The state file is the sole communication channel between phases.

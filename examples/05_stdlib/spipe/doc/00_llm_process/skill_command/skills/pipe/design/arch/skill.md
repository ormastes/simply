<!-- llm-process-gen: managed source=pipe_design_arch_skill source_sha256=ccf0406b3430bd362871349d7f0bc5ded190806398c26ff281bc6bee9459b81d content_sha256=06f9d4b7f1bad0a855ce06938b1797a6612a06cea99fe98517de6538c907e0c1 -->
# Arch Skill — Architecture + System Test Design

## Prerequisites
| Artifact | Path | If missing |
|----------|------|-----------|
| Requirements | `doc/02_requirements/feature/<feature>.md` | Run `/research` first |
| NFR | `doc/02_requirements/nfr/<feature>.md` | Run `/research` first |

## Phase 1: Architecture

1. Evaluate architecture patterns (ask user which to use)
2. Apply MDSOC pattern where appropriate (see `src/compiler/85.mdsoc/`)
3. Output: `doc/04_architecture/<feature>.md`

## Phase 2: System Test Design

1. Generate SPipe BDD tests: `test/03_system/app/<app_name>/feature/<feature>_spec.spl`
2. Follow SPipe rules:
   - `describe`, `it`, `expect` built-in (no import)
   - One assertion concept per test
   - Clear names: `it "adds two positive numbers":` not `it "works":`
   - `"""..."""` docstrings for generated docs
3. Matchers (built-in only): `to_equal`, `to_be`, `to_be_nil`, `to_contain`, `to_start_with`, `to_end_with`, `to_be_greater_than`, `to_be_less_than`
4. Verify every REQ-NNN has at least one test
5. Test plan: `doc/03_plan/sys_test/<feature>.md`
6. For broad lanes, define lower-model sidecars such as Codex Spark, Claude
   Haiku, or Claude Sonnet, or mark `N/A`; record merge owner and final
   normal/highest-capability reviewer in `doc/03_plan/agent_tasks/<feature>.md`
7. Before sidecars fan out, the best available model defines shared interface
   names, manual `step("...")` flow helper names, setup/checker helper names,
   and fail-fast placeholders using `assert(false)` or `fail(...)`

## Quality Check

1. Verify SPipe quality (target: A grade) — real assertions, edge cases, full REQ coverage
2. Verify generated-manual quality and normal/highest-capability review of
   merged sidecar output before handoff
3. Ask user: "Should architecture change?"
4. If yes, loop back

## Outputs
| Artifact | Location |
|----------|----------|
| Architecture | `doc/04_architecture/<feature>.md` |
| System tests | `test/03_system/app/<app_name>/feature/<feature>_spec.spl` |
| Test plan | `doc/03_plan/sys_test/<feature>.md` |
| Agent tasks | `doc/03_plan/agent_tasks/<feature>.md` |

## Critical Rules

- User must approve architecture before moving to `/design`
- Every REQ-NNN must have test coverage
- For MCP, LSP, and tool servers, design must cover startup path, hot request path, cache or index strategy, and invalidation
- Treat full-tree scans, repeated file rereads, and per-request subprocesses as first-class design risks
- Define performance budgets and lightweight observability for perf-sensitive features before implementation

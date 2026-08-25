<!-- llm-process-gen: managed source=claude_design_command source_sha256=f233a3f394bc92a029c2937e8f2e0bf405baac3d95714152e400190d70d92cce content_sha256=421a2290c22457c6515eee10aa910e8a68e36010d3fc9e362b70d904ee1ee9be -->
# Design Skill — Detail Design

## Prerequisites
| Artifact | Path | If missing |
|----------|------|-----------|
| Requirements | `doc/02_requirements/feature/<feature>.md` | Run `/research` first |
| Architecture | `doc/04_architecture/<feature>.md` | Run `/arch` first |

## Workflow

1. Create detailed design: data structures, algorithms, module interactions, error handling
2. Output: `doc/05_design/<feature>.md`
3. Agent task breakdown: `doc/03_plan/agent_tasks/<feature>.md`
   - For broad lanes, list lower-model sidecars such as Codex Spark, Claude
     Haiku, or Claude Sonnet, or mark `N/A`
   - Before sidecars fan out, the best available model defines shared
     interface names, manual `step("...")` flow helper names, setup/checker
     helper names, and fail-fast placeholders using `assert(false)` or
     `fail(...)`
   - Normal/highest-capability review must accept merged sidecar output and
     generated-manual quality before handoff

## Quality Check

1. Ask user: "Should design change?"
2. If yes, loop back

## Outputs
| Artifact | Location |
|----------|----------|
| Detail design | `doc/05_design/<feature>.md` |
| Agent tasks | `doc/03_plan/agent_tasks/<feature>.md` |

## Critical Rules

- Never design without approved architecture (`/arch`)
- If another LLM already created artifacts, review and extend — never overwrite

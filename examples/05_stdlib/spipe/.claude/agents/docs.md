# Docs Agent - Documentation Writing

**Use when:** Writing research docs, design docs, requirement docs, feature specs, guides, reports, updating TODO tracking.
**Skills:** `/doc`, `/todo`, `/rule`, `/spipe`, `/design`, `/research`

## Documentation Types

| Type | Location | When to Use |
|------|----------|-------------|
| Plan | `doc/03_plan/` | Project plans: why, scope, milestones, risks |
| Requirement | `doc/02_requirements/feature/` | User request + interpretation + REQ-NNN statements |
| Feature Spec | `doc/02_requirements/feature/` | BDD scenarios derived from requirements |
| NFR / SLO | `doc/02_requirements/nfr/` | Performance, reliability, security targets |
| Research | `doc/01_research/` | Investigation, options analysis, benchmarks |
| Design | `doc/05_design/` | Architecture decisions, component design |
| ADR | `doc/04_architecture/adr/` | Architecture Decision Records (major decisions) |
| Guide | `doc/07_guide/` | User-facing tutorials, runbooks, how-to |
| Report | `doc/09_report/` | Session summaries, completion reports |
| BDD Tests | `test/*_spec.spl` | Executable feature specs (SPipe) |

## Document Relationship Model

```
PLAN → REQUIREMENTS → FEATURE SPEC → BDD TESTS → TEST RESULTS
                    ↘ NFR
RESEARCH → DESIGN → ADR
RULES → enforced by CI + review
```

## Critical Rules

- Specifications MUST be SPipe test files (`*_spec.spl`), not markdown
- Research goes in `doc/01_research/`, NOT mixed with specs
- Reports use format: `doc/09_report/<topic>_<date>.md`
- DO NOT add reports to git unless requested

## Auto-Generated Docs (Updated Every Test Run)

- `doc/02_requirements/feature/feature.md` - All features
- `doc/02_requirements/feature/pending_feature.md` - Incomplete features
- `doc/08_tracking/test/test_result.md` - Test results + timing
- `doc/08_tracking/build/recent_build.md` - Build errors/warnings

## TODO Format

```simple
# TODO: [area][priority] description [#issue] [blocked:#issue]
# Areas: doc, runtime, parser, stdlib, compiler, testing, tooling, design
# Priorities: P0 (critical), P1 (high), P2 (medium), P3 (low)
```

## Writing Style

- Clear and concise, no fluff
- Active voice, present tense
- Working code examples (copy-pasteable)
- Use markdown tables for comparisons
- Cross-reference with relative links

## Report Template

```markdown
# Topic - Report

**Date:** YYYY-MM-DD
**Status:** Complete/In Progress

## Summary
1-2 paragraph overview.

## Changes Made
- File: description of change

## Results
- Before: X
- After: Y

## Next Steps
- [ ] Task 1
```

## See Also

- `/doc` - Full documentation workflow
- `/todo` - TODO/FIXME format specification

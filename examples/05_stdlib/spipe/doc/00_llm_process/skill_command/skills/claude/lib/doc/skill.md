# Documentation Writing Skill

## Document Relationship Model

```
PLAN -> REQUIREMENTS -> FEATURE SPEC -> BDD TESTS -> TEST RESULTS
REQUIREMENTS -> NFR;  RESEARCH -> DESIGN -> ADR;  GUIDES <- OPERATIONS
```

## Document Types & Locations

| Type | Location | Answers |
|------|----------|---------|
| Research | `doc/01_research/` | What to choose and why |
| Requirement | `doc/02_requirements/feature/` | What must system do |
| NFR / SLO | `doc/02_requirements/nfr/` | How well must it work |
| Plan | `doc/03_plan/` | What and when |
| Architecture | `doc/04_architecture/` | System structure |
| ADR | `doc/04_architecture/adr/` | Why this decision |
| Design | `doc/05_design/` | How it is built |
| Feature Spec | `doc/06_spec/` | How user experiences it |
| BDD Tests | `test/*_spec.spl` | Executable scenarios |
| Guide / Runbook | `doc/07_guide/` | How to use/operate |
| Rule | `doc/04_architecture/rule/` | Engineering standards |
| Tracking | `doc/08_tracking/` | Bugs, tests, build status |
| Report | `doc/09_report/` | Session/completion reports |

## Critical Rules

- NEVER write spec.md files -- write `*_spec.spl` instead (executable SPipe tests)
- Specifications live in `test/` as executable BDD tests
- Research goes in `doc/01_research/`, NOT mixed with specs
- Use SDN for config/data, not JSON/YAML

## Documentation Workflow (New Features)

1. **Research** -> `doc/01_research/<feature>.md` (if non-obvious)
2. **Requirements** -> `doc/02_requirements/feature/<feature>.md` (REQ-NNN)
3. **NFR** -> `doc/02_requirements/nfr/<feature>.md`
4. **Plan** -> `doc/03_plan/<feature>.md`
5. **Architecture** -> `doc/04_architecture/<feature>.md`
6. **Design** -> `doc/05_design/<feature>.md`
7. **ADR** -> `doc/04_architecture/adr/ADR-NNN-title.md` (major decisions)
8. **Feature Spec** -> `doc/06_spec/<feature>.md`
9. **BDD Tests** -> `test/*_spec.spl` (link Requirements + Design in docstring)
10. **Guide** -> `doc/07_guide/<feature>_guide.md` (if applicable)
11. **Report** -> `doc/09_report/<feature>_complete_YYYY-MM-DD.md`

## Research Document Format

```markdown
# Title - Research & Implementation Plan
**Date:** YYYY-MM-DD  |  **Status:** Research Phase
## 1. Problem Analysis (current state + requirements)
## 2. Proposed Solution (architecture + code examples)
## 3. Integration with Existing Infrastructure
## 4. Implementation Roadmap (phased tasks)
## 5. Testing Strategy
## 6. References
```

## Design Document Format

```markdown
# Component Design
**Status:** Draft | Review | Approved
## Overview, Design Principles, Architecture
## API Design (Simple code), Error Handling
## Performance/Security Considerations
## Alternatives Considered, Open Questions
```

## Writing Standards

- Clear, concise, active voice, present tense
- Working code examples (minimal, complete, commented)
- Semantic heading hierarchy, relative links for cross-refs
- `bin/simple doc-gen` to generate API docs from SPipe

## See Also

- `/spipe` for BDD test writing
- `doc/FILE.md` for document relationship model

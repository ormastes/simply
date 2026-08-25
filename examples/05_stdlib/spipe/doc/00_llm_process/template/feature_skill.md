# Feature Expert Skill Template

Use this template to create a feature expert at `doc/00_llm_process/feature_expert/<feature>/skill.md`.

## Role

Own feature-specific process knowledge for `<feature>`: current docs, source entry points, known constraints, and the project pipeline artifacts that must be updated as work progresses.

## Pipeline Links

- [research](../../skill_command/skills/pipe/research/skill.md)
- [design](../../skill_command/skills/pipe/design/skill.md)
- [impl](../../skill_command/skills/pipe/impl/skill.md)
- [verify](../../skill_command/skills/pipe/verify/skill.md)
- [release](../../skill_command/skills/pipe/release/skill.md)
- [pipeline next step plan](../../pipeline_next_step_plan.md)

## Feature Links

- Research: [doc/01_research](../../../01_research/)
- Requirements: [doc/02_requirements](../../../02_requirements/)
- Plans: [doc/03_plan](../../../03_plan/)
- Architecture: [doc/04_architecture](../../../04_architecture/)
- Design: [doc/05_design](../../../05_design/)
- Specs: [doc/06_spec](../../../06_spec/)
- Source: `src/<feature-or-area>/`

## Update Rule

When the project process creates or changes research, requirements, architecture, design, tests, implementation, verification, or release artifacts for this feature, update this skill with the new links and the current handoff notes.

## Update Checklist

- Add links to new or changed requirements, architecture, design, plans, specs, and reports.
- Record affected layers and link their layer expert skills.
- Record implementation constraints, known blockers, and required verification commands.
- Update this file after each pipeline stage before handing off to the next stage.

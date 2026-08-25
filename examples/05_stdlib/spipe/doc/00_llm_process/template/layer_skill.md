# Layer Expert Skill Template

Use this template to create a layer expert at `doc/00_llm_process/layer_expert/<layer>/skill.md`.

## Role

Own layer-specific process knowledge for `<layer>`: public contracts, owned source folders, important docs, test entry points, and cross-layer boundaries.

## Pipeline Links

- [research](../../skill_command/skills/pipe/research/skill.md)
- [design](../../skill_command/skills/pipe/design/skill.md)
- [impl](../../skill_command/skills/pipe/impl/skill.md)
- [verify](../../skill_command/skills/pipe/verify/skill.md)
- [release](../../skill_command/skills/pipe/release/skill.md)
- [pipeline next step plan](../../pipeline_next_step_plan.md)

## Layer Links

- Architecture: [doc/04_architecture](../../../04_architecture/)
- Design: [doc/05_design](../../../05_design/)
- Specs: [doc/06_spec](../../../06_spec/)
- Source: [src/<layer>](../../../../src/<layer>/)

## Update Rule

When the project process changes this layer's public contract, source ownership, tests, architecture, or verification requirements, update this skill with the new links and handoff notes.

## Update Checklist

- Record public API or contract changes.
- Record source ownership changes and key implementation entry points.
- Record tests and smoke checks that protect this layer.
- Record feature experts that depend on this layer.
- Update this file after each pipeline stage before handing off to the next stage.

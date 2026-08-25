# LLM Process Domain Expert

## Role

Own reusable LLM process design: command surfaces, skill layout, SPipe tests,
expert directories, and host-repository linking.

## Constraints

- Keep host project state under `.spipe/<feature>/`.
- Keep reusable process assets under `.spipe/spipe/`.
- Link reusable docs into `doc/00_llm_process/` by setup script, not by manual
  copy.
- Use platform-specific link commands because Windows junctions and Unix
  symlinks differ.

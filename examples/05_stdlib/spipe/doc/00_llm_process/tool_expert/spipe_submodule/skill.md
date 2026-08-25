# SPipe Submodule Tool Expert

## Role

Own host-repository setup for the SPipe submodule and its linked process
surfaces.

## Setup

Unix:

```sh
sh .spipe/spipe/scripts/setup-spipe-links.shs
```

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .spipe\spipe\scripts\setup-spipe-links.ps1
```

## Link Targets

The setup script links these host paths to this module:

- `doc/00_llm_process/skill_command`
- `doc/00_llm_process/spipe`
- `doc/00_llm_process/template`
- `doc/00_llm_process/project_expert`
- `doc/00_llm_process/domain_expert`
- `doc/00_llm_process/tool_expert`

## Verification

Run setup in dry-run mode first, then verify all targets are links or
junctions pointing into `.spipe/spipe`.

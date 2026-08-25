# SPipe

SPipe is the portable LLM process module for Simple projects. It packages the
pipeline commands, SPipe testing skill, templates, expert directories, setup
scripts, and integration docs that can be mounted into a host repository.

## Layout

- `doc/00_llm_process/spipe/` - SPipe testing and loop docs.
- `doc/00_llm_process/skill_command/` - command and skill command payloads.
- `doc/00_llm_process/template/` - reusable expert/skill templates.
- `doc/00_llm_process/project_expert/` - project and subproject experts.
- `doc/00_llm_process/tool_expert/` - tool integration experts.
- `doc/00_llm_process/domain_expert/` - domain experts.
- `.claude/`, `.codex/`, `.gemini/` - agent command payloads.
- `plugin/`, `mcp/`, `cli/` - reserved package roots for SPipe plugin,
  MCP, and CLI code.
- `scripts/` - host-repo setup and link scripts.

## CLI and MCP

The package exposes two dependency-free Node entrypoints:

```sh
node cli/spipe.js info
node cli/spipe.js experts
node cli/spipe.js doctor ../..
node mcp/server.js
```

`doctor` checks both reusable SPipe process surfaces and host mount invariants
such as `.spipe/doc`, `.spipe/spipe_project`, `.spipe/spipe`, and
`examples/spipe`.

When installed as an npm-style package, the binaries are `spipe` and
`spipe-mcp`.

The CLI also owns the reusable LLM fine-tune process. It can initialize host
attempt registries, record data downloads, model research, base-model choice,
tuning method, training script, eval results, retry decisions, and app/server
handoff evidence:

```sh
node cli/spipe.js fine-tune-init
node cli/spipe.js fine-tune-options
node cli/spipe.js fine-tune-next <attempt_id>
node cli/spipe.js fine-tune-report <attempt_id>
node cli/spipe.js fine-tune-verify <record.sdn>
```

Final requirement generation remains user-gated. Use
`fine-tune-select-requirements` only after the user chooses one feature option
and one NFR option.

## Build Check

Run the package layout check before publishing or updating a host submodule
pointer:

```sh
sh scripts/build.sh
```

Host repositories that mount SPipe as submodules should also keep the parent
index entries as gitlinks. In the Simple host, run:

```sh
sh scripts/check/check-spipe-submodule-gitlinks.shs --check
```

## Host Setup

From a host repository with this project mounted at `.spipe/spipe`:

```sh
sh .spipe/spipe/scripts/setup-spipe-links.shs
```

By default this links reusable SPipe surfaces into `doc/llm_process`. Host
repositories can override the process-doc root with `.spipe/config.sdn`:

```sdn
docs:
  host_process_doc: doc/00_llm_process
```

The Unix setup script also accepts `--doc-root PATH` or `SPIPE_DOC_ROOT=PATH`.

On Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .spipe\spipe\scripts\setup-spipe-links.ps1 -DocRoot doc\00_llm_process
```

Use `--force` or `-Force` only when replacing existing host directories with
links to this module.

## Subproject Experts

For repositories with subprojects stored as Git submodules, create
`.spipe/subproject_links.sdn` in the host repo. Each non-comment line links a
host expert target to a source directory inside the submodule:

```sdn
doc/00_llm_process/project_expert/example|examples/example/doc/00_llm_process/project_expert/example
```

The Unix setup script creates symlinks. The PowerShell setup script creates
Windows junctions.

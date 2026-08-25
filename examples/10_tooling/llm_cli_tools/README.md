# Simple LLM CLI Tools

LLM CLI wrapper library for the Simple language compiler. Provides unified access to multiple LLM CLI tools as programmatic APIs.

## Supported Providers

| Provider | CLI Binary | Skip Permissions Flag |
|----------|-----------|----------------------|
| `claude_cli` | `claude` | `--dangerously-skip-permissions` |
| `codex_cli` | `codex` | `--full-auto` + `--sandbox off` |
| `gemini_cli` | `gemini` | `--sandbox off` |
| `claude_api` | (HTTP) | N/A |
| `openai` | (HTTP) | N/A |
| `openai_compat` | (HTTP) | N/A |

## Directory Structure

```
src/lib/nogc_async_mut/llm/   # Library source
test/01_unit/app/llm_caret/       # Unit tests (pure functions, no CLI needed)
test/03_system/llm/               # System tests (requires CLI binaries)
doc/                           # Documentation and research
```

## Usage

Copy `src/lib/nogc_async_mut/llm/` into your Simple project's `src/lib/` directory.

```simple
use std.nogc_async_mut.llm.mod.{llm_init_defaults, llm_chat, llm_clear}

llm_init_defaults()
val response = llm_chat("What is 2 + 2?")
print response
```

### Switch Provider

```simple
use std.nogc_async_mut.llm.mod.{llm_init, llm_chat, llm_set_cli_path}

llm_init("codex_cli", "o4-mini")
llm_set_cli_path("codex")
val response = llm_chat("What is 2 + 2?")
```

## Testing

```bash
# Unit tests (no CLI binary needed)
bin/simple test test/01_unit/app/llm_caret/

# System tests (requires claude/codex/gemini CLI)
bin/simple test test/03_system/llm/
```

## Legal

See `doc/research/claude_cli_api_wrapper_legality.md` for Anthropic's policy on CLI automation.
Using API key authentication is recommended for production/automation use.

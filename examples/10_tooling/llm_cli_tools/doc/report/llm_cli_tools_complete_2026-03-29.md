# LLM CLI Tools -- Completion Report

**Date:** 2026-03-29
**Status:** Complete
**Component:** `examples/llm_cli_tools/`

---

## Summary

Multi-provider LLM CLI wrapper library for the Simple language. Provides a unified chat API that dispatches to seven LLM backends through a single `llm_chat()` entry point. Supports both CLI-based providers (Claude, Codex, Gemini) that invoke external binaries via `rt_process_run`, and HTTP API providers (Claude API, OpenAI, OpenAI-compatible) that use `rt_http_request`. Also includes a local torch provider for running HuggingFace models via Python subprocess.

The library follows a pure/impure function split: argument building and JSON parsing are pure (fully testable without external dependencies), while actual I/O is isolated to single impure send functions per provider.

---

## Provider Support

| Provider | Type | Binary/Endpoint | Default Model | Session Support |
|----------|------|----------------|---------------|-----------------|
| `claude_cli` | CLI subprocess | `claude` | (CLI default) | Yes (`--resume`) |
| `codex_cli` | CLI subprocess | `codex` | `o4-mini` | No |
| `gemini_cli` | CLI subprocess | `gemini` | (CLI default) | Yes (`--resume`) |
| `claude_api` | HTTP API | `api.anthropic.com/v1/messages` | `claude-sonnet-4-20250514` | No |
| `openai` | HTTP API | `api.openai.com/v1/chat/completions` | `gpt-4o` | No |
| `openai_compat` | HTTP API | `localhost:11434/v1/chat/completions` | `llama3` | No |
| `local_torch` | Python subprocess | (local model path) | (configured) | No |

---

## File Inventory

**Total:** 29 `.spl` files, 6,749 lines of Simple code.

### Library Source (15 files)

| File | Lines | Purpose |
|------|-------|---------|
| `src/lib/nogc_async_mut/llm/mod.spl` | 389 | Public API module -- `llm_init`, `llm_chat`, `llm_send`, history, provider dispatch |
| `src/lib/nogc_async_mut/llm/provider.spl` | 444 | Unified `dispatch_send()` routing to all 7 backends |
| `src/lib/nogc_async_mut/llm/claude_cli.spl` | 246 | Claude CLI wrapper -- arg builder, JSON/stream parser, send |
| `src/lib/nogc_async_mut/llm/claude_api.spl` | 162 | Anthropic Messages API -- body builder, response parser, send |
| `src/lib/nogc_async_mut/llm/codex_cli.spl` | 164 | Codex CLI wrapper -- arg builder, JSONL parser, send |
| `src/lib/nogc_async_mut/llm/gemini_cli.spl` | 138 | Gemini CLI wrapper -- arg builder, JSON parser, send |
| `src/lib/nogc_async_mut/llm/openai_api.spl` | 184 | OpenAI Chat Completions API -- body builder, response parser, send |
| `src/lib/nogc_async_mut/llm/openai_compat.spl` | 126 | OpenAI-compatible endpoint (Ollama, LM Studio, vLLM, LocalAI) |
| `src/lib/nogc_async_mut/llm/local_torch.spl` | 99 | Local HuggingFace model via Python subprocess |
| `src/lib/nogc_async_mut/llm/types.spl` | 226 | Core types: Message, ChatRequest, ChatResponse, StreamEvent, ProviderConfig |
| `src/lib/nogc_async_mut/llm/chat.spl` | 112 | Chat session management -- history, truncation, JSON builder |
| `src/lib/nogc_async_mut/llm/config.spl` | 249 | SDN config parser -- per-provider settings, env var resolution |
| `src/lib/nogc_async_mut/llm/json_helpers.spl` | 199 | JSON building/parsing utilities |
| `src/lib/nogc_async_mut/llm/server.spl` | 141 | HTTP API server stubs (OpenAI + Anthropic compatible endpoints) |
| `src/lib/nogc_async_mut/llm/__init__.spl` | 20 | Module exports |

### Application (1 file)

| File | Lines | Purpose |
|------|-------|---------|
| `src/app/agent/orchestrator.spl` | 204 | Agent orchestrator -- spawn/result/list for Codex/Gemini subagents |

### Unit Tests (12 files)

| File | Purpose |
|------|---------|
| `test/01_unit/app/llm_caret/chat_spec.spl` | Chat session management tests |
| `test/01_unit/app/llm_caret/claude_api_spec.spl` | Claude API body/response parsing tests |
| `test/01_unit/app/llm_caret/claude_cli_spec.spl` | Claude CLI arg builder and JSON parser tests |
| `test/01_unit/app/llm_caret/codex_cli_spec.spl` | Codex CLI arg builder and JSONL parser tests |
| `test/01_unit/app/llm_caret/config_spec.spl` | SDN config parser tests |
| `test/01_unit/app/llm_caret/gemini_cli_spec.spl` | Gemini CLI arg builder and JSON parser tests |
| `test/01_unit/app/llm_caret/json_helpers_spec.spl` | JSON building/parsing utility tests |
| `test/01_unit/app/llm_caret/openai_api_spec.spl` | OpenAI API body/response parsing tests |
| `test/01_unit/app/llm_caret/provider_spec.spl` | Provider list and dispatch routing tests |
| `test/01_unit/app/llm_caret/server_spec.spl` | HTTP server response builder tests |
| `test/01_unit/app/llm_caret/types_spec.spl` | Type constructors and predicates tests |
| `test/01_unit/agent/orchestrator_spec.spl` | Agent orchestrator tests |

### System Tests (1 file)

| File | Purpose |
|------|---------|
| `test/03_system/llm/llm_math_system_spec.spl` | End-to-end math question via live LLM |

---

## Architecture Summary

```
llm_chat("prompt")                     # Public API (mod.spl)
    |
    +-- LLM_PROVIDER dispatch          # if/elif routing
    |       |
    |       +-- _send_claude_cli()     # rt_process_run("claude", args)
    |       +-- _send_claude_api()     # rt_http_request("POST", url, ...)
    |       +-- _send_openai()         # rt_http_request("POST", url, ...)
    |       +-- _send_codex_cli()      # rt_process_run("codex", args)
    |       +-- _send_gemini_cli()     # rt_process_run("gemini", args)
    |
    +-- History management             # LLM_ROLES[] / LLM_CONTENTS[]
    |
    +-- JSON parsing                   # extract_json_string(), extract_json_int()

dispatch_send(provider, ...)           # Lower-level API (provider.spl)
    |
    +-- Same backends, returns LLMResponse struct with full metadata
```

**Two API layers:**
1. **`mod.spl` (high-level):** Module-level state, conversation history, `llm_chat()` returns plain text.
2. **`provider.spl` (low-level):** Stateless `dispatch_send()` returns `LLMResponse` with content, model, session_id, tokens, error, raw JSON.

**Per-provider modules** (`claude_cli.spl`, `openai_api.spl`, etc.) contain provider-specific pure functions (arg builders, response parsers) and a single impure send function. Unit tests target the pure functions exclusively.

**Configuration** (`config.spl`) uses an SDN line-based parser with per-provider sections. API keys resolve from environment variables at call time, not at config load time.

---

## Known Limitations

See [`doc/bug/llm_cli_tools_limitations.md`](../bug/llm_cli_tools_limitations.md) for the full list. Key items:

- No real-time streaming (stream-json is post-hoc buffered)
- No function calling / tool use wiring
- Flat JSON parsing may mismatch on nested keys
- No retry logic for transient failures
- HTTP status codes not checked on API responses
- Single session track for CLI providers
- Local torch requires Python + transformers + torch with no pre-check

---

## Documentation

| Document | Path |
|----------|------|
| README | `README.md` |
| Design plan | `doc/plan/llm_friendly.md` |
| Legality research | `doc/research/claude_cli_api_wrapper_legality.md` |
| Claudeignore research | `doc/research/claudeignore_research.md` |
| Integration testing guide | `doc/test/llm_integration_testing.md` |
| Limitations (this report) | `doc/bug/llm_cli_tools_limitations.md` |
| Completion report (this file) | `doc/report/llm_cli_tools_complete_2026-03-29.md` |
| Archived report | `doc/archive/report/llm_friendly.md` |

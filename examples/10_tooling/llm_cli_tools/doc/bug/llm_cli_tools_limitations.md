# LLM CLI Tools -- Known Limitations and Workarounds

**Date:** 2026-03-29
**Component:** `examples/llm_cli_tools/`

---

## 1. Provider-Specific Limitations

### 1.1 Claude CLI (`claude_cli`)

- **`--dangerously-skip-permissions` always passed.** Every Claude CLI invocation unconditionally adds this flag. There is no opt-out mechanism for callers who want interactive permission prompts.
- **Session resume is single-track.** `LLM_SESSION_ID` is a single module-level variable. Only one Claude CLI session can be resumed at a time; concurrent or interleaved sessions will clobber each other.
- **No system prompt on resume.** The `--system-prompt` flag is sent alongside `--resume`, but Claude CLI may ignore the system prompt when resuming an existing session. Behavior depends on CLI version.
- **Stream mode is post-hoc.** `claude_cli_stream()` calls `rt_process_run`, which blocks until the process exits, then parses NDJSON lines. There is no true incremental streaming -- the entire output is buffered before parsing.

### 1.2 Claude API (`claude_api`)

- **Hardcoded `anthropic-version: 2023-06-01`.** The API version header is fixed and cannot be configured. Future API changes may require code edits.
- **Max tokens defaults to 4096.** If `max_tokens` is not set, 4096 is used. For long-form generation this may silently truncate output.
- **No streaming support.** Only synchronous request/response is implemented. The `stream` field in `ChatRequest` is defined but never wired to any streaming endpoint.
- **Flat JSON parsing.** `extract_json_string(raw, "text")` searches for the first `"text":` key globally. If the response JSON has nested objects with a `"text"` key at a shallower level, the wrong value may be extracted.

### 1.3 OpenAI API (`openai`)

- **Same flat JSON parsing issue.** `extract_json_string(raw, "content")` finds the first `"content":` in the response. The OpenAI response nests content inside `choices[0].message.content`, so the parser relies on `"content"` appearing before any other key with that name. Unusual response shapes may break extraction.
- **No function calling / tool use support.** The `tools` field in `ChatRequest` is defined but not wired to OpenAI's function calling API.
- **No token usage tracking in dispatch.** `_dispatch_openai` in `provider.spl` always returns `input_tokens: 0, output_tokens: 0` even though usage data is available in the response.

### 1.4 OpenAI-Compatible (`openai_compat`)

- **Default URL is `http://localhost:11434` (Ollama).** If `base_url` is not configured, requests go to a local Ollama instance. This will fail silently if Ollama is not running.
- **No model validation.** The model name is sent as-is. Misspelled model names produce opaque errors from the backend.
- **API key is optional.** If no key is configured, the `Authorization` header is omitted entirely. Some endpoints require authentication even for local use.

### 1.5 Codex CLI (`codex_cli`)

- **No session/conversation continuity.** Each `codex_cli_send` is a one-shot execution (`exec` subcommand). Multi-turn conversations are not supported; history is not forwarded.
- **JSONL parsing is best-effort.** The parser iterates all lines looking for `role: "assistant"` and takes the last one. If Codex changes its JSONL schema, parsing may silently return empty content.
- **`--sandbox off` always passed.** There is no way to enable sandboxing through the wrapper.

### 1.6 Gemini CLI (`gemini_cli`)

- **No system prompt support.** `build_gemini_args` does not accept a system prompt parameter. The Gemini CLI may support `--system-instruction` but it is not wired.
- **Session ID not extracted from response.** `_dispatch_gemini_cli` always returns `session_id: ""`. Multi-turn resume may not persist session IDs correctly.
- **Response field is `"response"`, not `"result"`.** A mismatch between provider response schemas. This is handled correctly but is a maintenance risk if Gemini changes its JSON format.

### 1.7 Local Torch (`local_torch`)

- **Requires Python 3 + transformers + torch.** External runtime dependencies that are not checked before invocation. Errors appear as generic "Python error" messages.
- **Temp files in `/tmp/`.** Prompt, script, and output files are written to `/tmp/` with timestamp-based names. On Windows or restricted environments, `/tmp/` may not exist.
- **No GPU detection.** The generated Python script uses `device_map='auto'` which may fail if no GPU is available and the model is too large for CPU.
- **No conversation history.** Each call is independent; there is no message history forwarding.

---

## 2. Missing Features

| Feature | Status | Notes |
|---------|--------|-------|
| Streaming (real-time token delivery) | Not implemented | `stream` field exists in `ChatRequest` but is unused |
| Function calling / tool use | Not implemented | `tools` field exists but is not wired to any provider |
| Image/multimodal input | Not implemented | All providers accept `text` only |
| Rate limiting / retry logic | Not implemented | HTTP 429 errors are returned as-is |
| Request timeout configuration | Not implemented | Relies on `rt_process_run` / `rt_http_request` defaults |
| Structured output (JSON mode) | Partial | `json_schema` flag exists for Claude CLI only |
| Cost tracking / budget limits | Not implemented | Token counts are parsed but not aggregated |
| Async/concurrent requests | Not implemented | All calls are synchronous blocking |
| Prompt template system | Not implemented | Prompts are raw text |
| Response caching | Not implemented | Every call hits the provider |

---

## 3. Runtime Dependencies

| Dependency | Required By | How to Check |
|------------|-------------|--------------|
| `claude` CLI binary | `claude_cli` provider | `which claude` |
| `codex` CLI binary | `codex_cli` provider | `which codex` |
| `gemini` CLI binary | `gemini_cli` provider | `which gemini` |
| `ANTHROPIC_API_KEY` env var | `claude_api` provider | `echo $ANTHROPIC_API_KEY` |
| `OPENAI_API_KEY` env var | `openai` provider | `echo $OPENAI_API_KEY` |
| `python3` + `transformers` + `torch` | `local_torch` provider | `python3 -c "import transformers, torch"` |
| Ollama / LM Studio running locally | `openai_compat` provider | `curl http://localhost:11434/v1/models` |
| `rt_http_request` runtime function | API providers | Provided by Simple runtime |
| `rt_process_run` runtime function | CLI providers | Provided by Simple runtime |

---

## 4. Error Handling Gaps

- **No structured error types.** All errors are `text` strings prefixed with `"ERROR: "`. There is no error enum or error code system. Callers must string-match to distinguish error categories.
- **HTTP status codes ignored.** The `rt_http_request` return includes a status code (`result.0`) but `_send_claude_api`, `_send_openai`, and `_dispatch_compat` do not check it. A 401 or 429 response with a valid body may be treated as success.
- **No retry on transient failures.** Network timeouts, rate limits (HTTP 429), and server errors (HTTP 5xx) are returned immediately with no retry.
- **Silent empty responses.** If a provider returns an empty body with HTTP 200, the JSON extractors return empty strings rather than raising an error. The caller receives an empty `content` field with no indication of failure.
- **Process run failures are generic.** CLI providers report `"exited with code N"` but do not distinguish between "binary not found", "authentication error", and "rate limit exceeded".
- **Config parse errors are swallowed.** `parse_config_text` applies key-value pairs silently. Unknown sections, typos in keys, or invalid values produce no warnings.

---

## 5. Workarounds

| Limitation | Workaround |
|------------|-----------|
| No streaming | Use `claude_cli_stream()` for post-hoc NDJSON parsing (not real-time but gives event-level access) |
| Single session track | Call `llm_clear()` between sessions; store session IDs externally |
| No retry logic | Wrap `llm_chat()` in a loop with manual delay using `rt_time_now_unix_micros()` |
| Flat JSON parsing | For complex responses, access `.raw` field and parse manually |
| No system prompt on Gemini | Prepend system instructions to the user prompt text |
| HTTP status not checked | Check `response.raw` field and parse status manually if needed |
| `/tmp/` unavailable | Configure `LOCAL_*` paths or set `python_path` to a script that handles temp dirs |

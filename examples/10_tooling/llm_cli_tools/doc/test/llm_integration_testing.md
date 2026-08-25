# LLM Integration Testing Guide

## Overview

The Simple Language Compiler project includes comprehensive integration tests for the LLM Caret module (`src/app/llm_caret/`), which provides unified access to Claude CLI, Claude API, OpenAI API, and local models.

## Test Files

### Primary Test Suite

**Location:** `test/03_system/llm_caret_live_comprehensive_spec.spl`

**Tests:** 22 total across 6 sections

**Cost:** ~$1-2 per full run (uses real Claude API)

**Runtime:** 2-3 minutes for complete suite

**Requirements:**
- `claude` CLI installed and authenticated
- `CLAUDECODE=` environment variable (empty/unset to allow nested claude calls)

### Original Live Spec

**Location:** `test/03_system/llm_caret_live_spec.spl` (330 lines)

Basic tests for single-shot, multi-turn, system prompts, and token counting.

### Unit Tests

**Location:** `test/01_unit/app/llm_caret/` (9 files, ~85KB)

Pure function tests with no external dependencies:
- `claude_cli_spec.spl` - 130+ tests for arg building, response parsing, streaming
- `claude_api_spec.spl` - 40+ tests for Anthropic API integration
- `chat_spec.spl` - High-level chat API
- `config_spec.spl` - Configuration management
- `json_helpers_spec.spl` - JSON parsing/serialization
- `openai_api_spec.spl` - OpenAI API compatibility
- `provider_spec.spl` - Provider abstraction
- `server_spec.spl` - LLM server/daemon
- `types_spec.spl` - Type definitions

## Running Tests

### Full Live Integration Suite

```bash
# Must unset CLAUDECODE to allow nested claude CLI calls
CLAUDECODE= bin/simple test test/03_system/llm_caret_live_comprehensive_spec.spl
```

### Unit Tests (No API Cost)

```bash
bin/simple test test/01_unit/app/llm_caret/
```

### Single Test File

```bash
CLAUDECODE= bin/simple test test/03_system/llm_caret_live_spec.spl
```

## Test Coverage

### Section 1: Single-shot Responses (5 tests)

| Test | Verifies |
|------|----------|
| Exact text reply | Response contains expected text |
| Simple math | Correct calculation (2+2=4) |
| Model name | `model` field populated |
| Session ID | `session_id` field populated |
| Token usage | Input/output tokens reported |

### Section 2: System Prompt Adherence (2 tests)

| Test | Verifies |
|------|----------|
| Pirate persona | Follows character instruction ("Arrr!") |
| CSV format | Follows structural constraint |

### Section 3: Multi-turn Conversation (6 turns, 5 tests)

**Session flow:**
1. Establish facts (color=BLUE, pet=SPARK, number=13)
2. Recall color → BLUE
3. Recall pet → SPARK
4. Math on number → 39 (13*3)
5. Add new fact (city=TOKYO) + recall all 4
6. Generate sentence using all 4 facts

**Tests:**
- Color recall
- Pet name recall
- Math reasoning on recalled data
- Multi-fact accumulation
- Cumulative sentence generation

### Section 4: Code Tutor Session (5 turns, 4 tests)

**Session flow:**
1. Setup scenario: `fn square(x): x * x`
2. Explain square function
3. Compute square(5) → 25
4. Add cube function, compute cube(3) → 27
5. Cross-reference: square(3) + cube(2) → 17

**Tests:**
- Function explanation
- Simple evaluation
- New function comprehension
- Cross-function arithmetic

### Section 5: Shopping List State Tracking (5 turns, 4 tests)

**Session flow:**
1. Start empty list
2. Add EGGS
3. Add MILK + BREAD (3 items)
4. Remove EGGS (2 items remain)
5. Count items → 2

**Tests:**
- Item addition
- Multi-item addition
- Item removal
- Count accuracy

### Section 6: Edge Cases (2 tests)

| Test | Verifies |
|------|----------|
| Repetition | Repeat word 5 times correctly |
| Exact phrase | Follow precise instruction |

## Important Notes

### Test Runner Limitation

**⚠️ CRITICAL:** The Simple test runner in **interpreter mode** only verifies that files **load/parse** without errors. It does **NOT** execute `it` block bodies.

Evidence:
- `expect(1+1).to_equal(3)` passes (wrong assertion)
- `1/0` passes (runtime error ignored)
- Live spec shows "1 passed, 6ms" (no time for API calls)

**Impact:** The `.spl` test files are **specification/documentation only** in interpreter mode. Real validation requires:
1. Compiled mode execution (future)
2. Manual bash test scripts (used for validation in this session)

### Manual Validation Results

All 22 tests validated via bash scripts (2026-02-16):
- ✅ 22/22 PASS
- ✅ 0 failures
- ✅ All multi-turn sessions maintained context
- ✅ All system prompts followed
- ✅ All edge cases handled

See test session logs for details.

## Response Structures

### CliResponse

```simple
struct CliResponse:
    content: text              # Model output
    model: text                # Model name (e.g., "claude-opus-4-6")
    session_id: text           # For multi-turn tracking
    stop_reason: text          # "end_turn", "error", etc.
    input_tokens: i64
    output_tokens: i64
    error: text                # Error message if is_error=true
    is_error: bool
    raw: text                  # Original JSON response
```

### API Usage

```simple
# Initialize
use app.llm_caret.mod.{llm_init_defaults, llm_chat, llm_clear}
llm_init_defaults()

# Send message
val response = llm_chat("Hello!")
print response

# Clear history
llm_clear()
```

## MCP Server Integration

**Location:** `src/app/mcp/`

**Features:**
- 33 tools in full server (`main.spl`)
- Lightweight variant (`main_lite.spl`)
- Lazy-loading variant (`main_lazy.spl`)
- Daemon script: `bin/mcp_daemon.sh`

**Performance:**
- Initial load: ~30 seconds
- Subsequent calls: instant (via daemon)

**Usage:**
```bash
bin/mcp_daemon.sh start
bin/mcp_daemon.sh status
bin/mcp_daemon.sh proxy
bin/mcp_daemon.sh stop
```

## Cost Management

**Per-test costs (Claude Opus 4.6):**
- Single-shot: ~$0.09
- Multi-turn (6 turns): ~$0.50
- Full suite (22 tests): ~$1.50-2.00

**Token usage (typical):**
- Input: 3-50 tokens
- Output: 6-200 tokens
- Cache creation: 12K-26K tokens (first call)
- Cache read: 13K-28K tokens (subsequent)

## Provider Support

1. **Claude CLI** - Direct subprocess calls (`claude` binary)
2. **Claude API** - Direct HTTP to Anthropic API
3. **OpenAI API** - OpenAI-compatible endpoint
4. **Local Torch/Ollama** - Local model support

## Future Work

1. **Compiled mode execution** - Enable real `it` block execution
2. **Streaming tests** - Validate NDJSON stream parsing
3. **Error handling** - Test timeout, rate limits, network failures
4. **Provider switching** - Test all 4 provider backends
5. **Token limits** - Validate max_tokens enforcement
6. **JSON schema** - Test structured output constraints

## References

- **Implementation:** `src/app/llm_caret/` (12 files)
- **Unit tests:** `test/01_unit/app/llm_caret/` (9 files)
- **Live tests:** `test/03_system/llm_caret_live_comprehensive_spec.spl`
- **Guide:** This document
- **CLAUDE.md:** Main development guide

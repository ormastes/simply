<!-- llm-process-gen: managed source=gemini_design_skill source_sha256=1a9de54c39ff8fc15d051cdedbebbac6af8ea47236db6380cf53e68e4ccba7b4 content_sha256=bfcc4b59919451357e84424682040e9b333f59351a16098b1c80858371f15dfb -->
# design

Source: `.gemini/commands/design.toml`

Create architecture, UI design, system tests, and detail design. Self-sufficient — if research/requirements missing, does them first."

the design pipeline for the given feature. Self-sufficient — if prerequisites missing, create them.

Check prerequisites:
- doc/02_requirements/feature/<feature>.md (if missing, run research first)
- doc/02_requirements/nfr/<feature>.md (if missing, run research first)

Phase 1: UI Design (if applicable)
- TUI: doc/05_design/<feature>_tui.md
- GUI: doc/05_design/<feature>_gui.md

Phase 2: Architecture — doc/04_architecture/<feature>.md
- For MCP, LSP, and tool servers, include startup path, hot request path, cache or index strategy, invalidation strategy, and perf budgets

Phase 3: System Test Design
- SPipe BDD tests: test/03_system/app/<app_name>/feature/<feature>_spec.spl
- Matchers (built-in only): to_equal, to_be, to_be_nil, to_contain, to_start_with, to_end_with, to_be_greater_than, to_be_less_than
- Every REQ-NNN must have at least one test

Phase 4: Detail Design — doc/05_design/<feature>.md
- Agent tasks: doc/03_plan/agent_tasks/<feature>.md
- Broad lanes list lower-model sidecars such as Codex Spark, Claude Haiku, or
  Claude Sonnet, or mark N/A; include merge owner and final
  normal/highest-capability reviewer.
- Before sidecars fan out, the best available model defines shared interface
  names, manual step("...") flow helper names, setup/checker helper names, and
  fail-fast placeholders using assert(false) or fail(...).

Phase 5: Quality Check — verify SPipe quality, generated-manual quality, and
normal/highest-capability review of merged sidecar output; ask user if changes
needed.

If another LLM already created artifacts, review and extend — never overwrite.
Treat full-tree scans, repeated file rereads, and per-request subprocesses as design risks unless explicitly justified.
"""

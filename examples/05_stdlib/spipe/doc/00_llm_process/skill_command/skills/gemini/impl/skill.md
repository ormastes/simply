<!-- llm-process-gen: managed source=gemini_impl_skill source_sha256=0d15bc66bf1fc5269b36338a708652ebc3bbcd7f278d03da039012248b8a4cf6 content_sha256=78b583be04f6d37e58462528ddf6b17ffd69270682f255cfc8a9dfca6703f6e5 -->
# impl

Source: `.gemini/commands/impl.toml`

Implement a feature end-to-end. Self-sufficient — if research/design missing, creates them first."

mplement the given feature. Self-sufficient — if prior artifacts missing, create them first.

Check what exists and skip completed phases:
- doc/01_research/local/<feature>.md → skip research
- doc/02_requirements/feature/<feature>.md → skip requirements
- doc/04_architecture/<feature>.md → skip architecture
- doc/05_design/<feature>.md → skip design

Phases:
1-3: Research + Requirements (skip if exist)
4-5: Plan + Design + Architecture (skip if exist)
6-7: System Test + Doc Consistency
8: Implementation in src/**/<feature>.spl
9-10: Unit + IT Tests (80%+ coverage) + Doctest
11-13: Bug Reports + Duplication Check + Refactoring
14: Full Test Suite (bin/simple test test --whole --mode=interpreter + bin/simple lint <changed .spl files>)
15: Run /verify + VCS Sync

All code in .spl — no Python, no Bash.
Stub Prevention: no pass_todo in final code.
Production MCP or LSP wrappers must use cached compiled artifacts.
Avoid full-tree scans and per-request subprocesses in hot request handlers when a cache or index is viable.
If cached or indexed data depends on writable files, implement explicit invalidation on mutation paths.
Add perf smoke checks for startup and representative tool requests when touching performance-sensitive tooling.
"""

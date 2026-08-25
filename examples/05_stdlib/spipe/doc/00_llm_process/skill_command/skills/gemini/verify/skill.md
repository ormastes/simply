<!-- llm-process-gen: managed source=gemini_verify_skill source_sha256=cacfbb87838e7449142200065594b17d6ec133ae2cfd85f22688e1f288ffa272 content_sha256=23d69c42239266d48eb55b09e03333ded5c8155851763e3c66415e4403521dc5 -->
# verify

Source: `.gemini/commands/verify.toml`

Production readiness verification. Checks tests, implementation, requirements, NFR, and docs.

Run production readiness verification. Self-sufficient — any LLM can run independently.

Check scope: current changes (default), specific file, or --all for full project.

Phase 1: Scope Detection — identify spec files, source files, doc files in scope.

Phase 2: SPipe Tests — every it block has real assertions (not pass_todo, not expect(true).to_equal(true)).
Generated/manual SPipe docs for changed specs must exist under doc/06_spec,
report 0 stubs, and read as manuals for scenario-oriented specs.
`find doc/06_spec -name '*_spec.spl' | wc -l` must return 0.
Broad lanes must complete lower-model sidecars such as Codex Spark, Claude
Haiku, or Claude Sonnet, or record N/A, then pass normal/highest-capability
review of generated-manual quality, coverage, exclusions, and done marks.

Phase 3: Implementation — no stub functions, no hardcoded returns, complete error handling.

Phase 4: Feature Requirements — every REQ-NNN traced to code + test.

Phase 5: NFR — performance benchmarks, security, reliability, observability.

Phase 6: Architecture & Design Docs — doc/04_architecture/ and doc/05_design/ updated.
Workflow/tooling/evidence/spec/verification contract changes must update
matching doc/07_guide, doc/06_spec, .codex/skills, .agents/skills,
.claude/skills, .claude/agents/spipe, and .gemini/commands docs before PASS.

Report: [PASS], [FAIL], [WARN] per item, summary table at end.
Must show STATUS: PASS before release.
Fail wrapper verification if a production MCP or LSP launcher executes raw source instead of a cached compiled artifact.
Audit hot request paths for repeated scans, repeated rereads, per-request subprocesses, and missing cache invalidation on writes.
Require startup and representative request perf evidence for performance-sensitive tooling changes.
"""

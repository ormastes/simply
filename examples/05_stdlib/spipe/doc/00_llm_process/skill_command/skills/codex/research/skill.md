<!-- llm-process-gen: managed source=codex_research_skill source_sha256=880eeced2e3ae7bd4cd6181631566b4d6fa7ed60165383f9e33d27e9b02a67c9 content_sha256=880eeced2e3ae7bd4cd6181631566b4d6fa7ed60165383f9e33d27e9b02a67c9 -->
---
name: research
description: "Codex research skill (Step 2 in cooperative pipeline). Forked parallel research: spawn multiple research threads, generate requirement options with pros/cons/effort, user selection workflow. Self-sufficient — does local + domain research if prior steps missing."
---

# Research — Codex (Cooperative Step 2)

**Cooperative Phase:** Step 2 — Research & Requirement Options
**Self-sufficient.** Does local + domain research if Step 1 (Claude local research) was skipped. Does not depend on any prior step or other LLM.

## Tools

- **Simple MCP** — query codebase structure, module graph
- **Simple LSP MCP** — symbol lookup, go-to-definition, references
- **Context7 MCP** — external library documentation
- **Playwright CLI** — web research for domain knowledge, papers, prior art

## Phase 1: Local Research

Search `src/` and `doc/` for related code, types, call chains, prior research, ADRs.

- Use forked parallel threads: one for `src/compiler/`, one for `src/lib/`, one for `doc/`
- Merge findings into a single local research document

Output: `doc/01_research/local/<feature>.md`

## Phase 2: Domain Research

Web search for external knowledge, papers, language design references, prior art.

- Spawn parallel research threads per sub-topic (e.g., type system, optimization, runtime)
- Each thread produces a summary with citations
- Merge into domain research document

Output: `doc/01_research/domain/<feature>.md`

## Phase 3: Requirement Options

Generate 2-4 options per feature requirement, each with:
- **Description** — what the option does
- **Pros** — benefits, alignment with existing architecture
- **Cons** — risks, complexity, breaking changes
- **Effort** — T-shirt size (S/M/L/XL) with estimated file count

Output:
- Feature options: `doc/02_requirements/feature/<feature>_options.md`
- NFR options: `doc/02_requirements/nfr/<feature>_options.md`

## Phase 4: User Decision

Ask: **"Which feature option and NFR targets do you want?"**

After selection:
- Remove unchosen option files
- Write final requirements:
  - `doc/02_requirements/feature/<feature>.md`
  - `doc/02_requirements/nfr/<feature>.md`

## Forked Parallel Research Pattern (Codex Strength)

Codex excels at forked parallel research. When investigating a feature:

1. **Fork** — identify 3-5 independent research threads
2. **Execute** — run each thread in parallel (local code search, web search, doc scan)
3. **Merge** — combine findings, resolve contradictions, synthesize
4. **Rank** — order options by feasibility and alignment with existing codebase

## Multi-LLM Collaboration

- If Claude (Step 1) already produced `doc/01_research/local/<feature>.md`, **extend it** — never overwrite
- If skipping to Step 2 directly, do all research phases yourself
- Tag Codex-produced artifacts with `<!-- codex-research -->` comment

## Artifacts Produced

| Artifact | Path |
|----------|------|
| Local research | `doc/01_research/local/<feature>.md` |
| Domain research | `doc/01_research/domain/<feature>.md` |
| Feature options | `doc/02_requirements/feature/<feature>_options.md` |
| NFR options | `doc/02_requirements/nfr/<feature>_options.md` |
| Final feature req | `doc/02_requirements/feature/<feature>.md` |
| Final NFR | `doc/02_requirements/nfr/<feature>.md` |

## Rules

- NEVER skip local research — always check `src/` and `doc/` first
- Draft requirements are OPTIONS — user MUST select
- All code examples in `.spl` — no Python, no Bash
- Generics use `<>` not `[]` — `Option<T>`, `List<Int>`
- NO inheritance — use composition, traits, mixins
- Use `Result<T, E>` + `?` for error handling (no try/catch/throw)

<!-- llm-process-gen: managed source=pipe_research_skill source_sha256=efe93daadcb797efb9dadac0f65cadf130250ff6a6e975228599e628bfa243e7 content_sha256=efe93daadcb797efb9dadac0f65cadf130250ff6a6e975228599e628bfa243e7 -->
# Research Skill (Claude) — Step 1: Local + Domain Research

See `lib/research_common.md` for shared format and templates.

## Cooperative Phase
**Step 1 of 5** in multi-LLM cooperative pipeline.
- Solo mode: Full research (local + domain + requirements)
- Cooperative mode: Local research + domain research, then hand off to `/research_codex` (Step 2)

**Always capture the user's original request verbatim in the research doc under `## User Request`.**

## Local Implementation Research

### Tools
- **Simple MCP:** `bin/simple query workspace-symbols`, `bin/simple query references`, `bin/simple query hover`
- **LSP Plugin:** `bin/simple query definition`, `bin/simple query completions`, `bin/simple query call-hierarchy`
- **Obsidian CLI:** Search `doc/` vault for existing research/design/requirement docs

### Agent Team
Spawn parallel agents:
- **Agent 1:** Source code exploration via MCP + LSP (search `src/`)
- **Agent 2:** Doc exploration via Obsidian CLI (search `doc/`)
- Merge results into research summary

### Output
- `doc/01_research/local/<feature>.md`

## Domain Research

### Tools
- **Web Search:** Search for external references, API docs, papers
- **Obsidian CLI:** Search existing `doc/01_research/domain/` for prior work

### Workflow
1. Search existing research docs for prior analysis
2. Web search for external knowledge
3. Synthesize into research document

### Output
- `doc/01_research/domain/<feature>.md`

## Requirement Samples

Generate draft requirement options:
- Feature requirements -> `doc/02_requirements/feature/<feature>_draft.md`
- NFR requirements -> `doc/02_requirements/nfr/<feature>_draft.md`

## Handoff
Pass research results to `/research_codex` (Step 2) or proceed to `/arch` (solo mode).

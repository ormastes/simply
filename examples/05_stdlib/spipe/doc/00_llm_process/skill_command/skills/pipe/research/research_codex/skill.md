<!-- llm-process-gen: managed source=pipe_research_codex_skill source_sha256=a6b34de071e5cd5ffea60bc93b2fb96b4bad7b0a5d1115d83bcc9e46197de775 content_sha256=a6b34de071e5cd5ffea60bc93b2fb96b4bad7b0a5d1115d83bcc9e46197de775 -->
# Research Skill (Codex) — Step 2: Forked Agent Research

See `lib/research_common.md` for shared format and templates.

## Cooperative Phase
**Step 2 of 5** in multi-LLM cooperative pipeline.
- Reads Claude Step 1 output from `doc/01_research/local/` and `doc/01_research/domain/`
- Forks parallel research agents for deeper analysis
- Generates requirement option sets for user selection
- Plugin: `tools/claude-plugin/codex-research/`

## Input
- `doc/01_research/local/<feature>.md` (from Step 1)
- `doc/01_research/domain/<feature>.md` (from Step 1)

## Forked Agent Pattern

Spawn 3 parallel Codex agents:
- **Agent A — Alternative Approaches:** Explore alternative architectures and patterns
- **Agent B — Requirement Validation:** Check requirements against Simple language constraints
- **Agent C — Risk Analysis:** Identify implementation risks and edge cases

Merge results into consolidated research.

## Output
- `doc/01_research/codex/<feature>.md` — consolidated Codex research
- `doc/02_requirements/feature/<feature>_options.md` — 2-3 requirement option sets for user selection

## Handoff
User selects requirement option, then proceed to `/ui` (Step 3) or `/arch` (Step 4).

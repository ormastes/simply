<!-- llm-process-gen: managed source=gemini_research_skill source_sha256=a01add2ef81563bc11f56650ebf884daffd0c2521cdb666de032f3c8a81bdf5c content_sha256=f37a387bdb02119c2793b56a7376eb243b703a867851c37b1a54b5c4b71bac49 -->
# research

Source: `.gemini/commands/research.toml`

Run local + domain research for a feature. Self-sufficient — does not depend on any prior step."

un the research pipeline for the given feature. Self-sufficient — do all steps yourself.

Phase 1: Search src/ and doc/ for related code, types, call chains, prior research, ADRs.
Output: doc/01_research/local/<feature>.md

Phase 2: Web search for external knowledge, papers, prior art.
Output: doc/01_research/domain/<feature>.md

Phase 3: Generate requirement options with pros/cons/effort.
Feature: doc/02_requirements/feature/<feature>_options.md
NFR: doc/02_requirements/nfr/<feature>_options.md

Phase 4: Ask user to select, then write final requirements.

If another LLM already did research, extend it — never overwrite.
All code in .spl — no Python, no Bash.
"""
<!-- llm-process-gen: managed source=gemini_browser_research_skill source_sha256=f0e3bd44e49445d68a532f7cd1d41ce966502d20cca95d0352654a50edb084e3 content_sha256=9709a7c45b2bdb8d8f5b85e342ad801f87c6d44a489538a51a830a889497839a -->
# browser_research

Source: `.gemini/commands/browser_research.toml`

Browser-based domain research using Chrome MCP and Playwright for web scraping, screenshots, and knowledge gathering.

Perform browser-based research for the given topic or feature. Uses Chrome MCP and Playwright CLI.

Phase 1: Interactive Web Research (Chrome MCP)
- Search for documentation, tutorials, specifications related to the topic
- Navigate official docs, API references, and standards
- Capture key pages as screenshots for visual reference
- Store screenshots in doc/01_research/domain/<topic>_screenshots/

Phase 2: Data Extraction (Playwright CLI)
- Scrape structured data from relevant pages (API docs, spec tables, compatibility matrices)
- Extract code examples, configuration patterns, schema definitions
- Parse comparison tables, feature matrices, benchmark results
- Save extracted data as SDN format (not JSON/YAML) where structured

Phase 3: Visual Reference Collection
- Capture UI/UX examples from similar tools and products
- Screenshot design patterns, component libraries, layout approaches
- Organize references by category: navigation, forms, data display, feedback
- Store in doc/01_research/domain/<topic>_visual_ref/

Phase 4: Synthesis
- Consolidate findings into doc/01_research/domain/<topic>.md
- Include source URLs with access dates
- Summarize key patterns, best practices, and anti-patterns
- List technology options with pros/cons

If another LLM already did research, extend it — never overwrite.
Output: doc/01_research/domain/<topic>.md (+ screenshots directory)
""
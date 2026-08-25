<!-- llm-process-gen: managed source=gemini_ui_design_skill source_sha256=7d25631b3c92fc0b3ee8bcda2f456d6446691371747f7201a634173759ddd4d1 content_sha256=0547aaa982e59c6478adee435297235625e3d800c01a773ec7092903b5972c49 -->
# ui_design

Source: `.gemini/commands/ui_design.toml`

Create TUI/GUI mockups, wireframes, and interaction flows. Gemini's primary strength skill for visual design.

reate UI/UX design artifacts for the given feature. Self-sufficient — if no requirements exist, gather context first.

Check prerequisites:
- doc/02_requirements/feature/<feature>.md (if missing, search src/ and doc/ for context)
- doc/02_requirements/nfr/<feature>.md (if missing, infer from feature scope)

Phase 1: TUI Mockup (if applicable)
- Use box-drawing characters (single: +-|, double: ═║╔╗╚╝, rounded: ╭╮╰╯)
- Annotate ANSI colors: [green], [bold], [dim], [cyan], [red] etc.
- Show cursor position, focus states, selection highlighting
- Include keyboard shortcut annotations (e.g., [Ctrl+S] Save, [Tab] Next)
- Output: doc/05_design/<feature>_tui.md

Phase 2: GUI Mockup (if applicable)
- Wireframe layout with responsive breakpoints (mobile/tablet/desktop)
- Component hierarchy: containers, panels, buttons, inputs, lists
- Color palette with hex codes, typography scale
- Interaction states: default, hover, active, disabled, error
- Output: doc/05_design/<feature>_gui.md

Phase 3: Component Inventory
- List all UI components needed with their props/states
- Map components to existing src/lib/ modules where possible
- Identify new components to create
- Output: included in the design doc

Phase 4: Interaction Flow
- User journey diagram (text-based flowchart)
- State transitions, error paths, loading states
- Keyboard navigation order (TUI) or tab order (GUI)
- Output: included in the design doc

Phase 5: Visual Reference (optional, if Chrome MCP available)
- Use Chrome MCP to capture reference screenshots from similar tools
- Use Stitch MCP for rapid HTML prototype if GUI mockup needed
- Attach screenshots as references in doc/05_design/<feature>_visual_ref/

If another LLM already created design artifacts, review and extend — never overwrite.
All implementation code in .spl — no Python, no Bash.
"""
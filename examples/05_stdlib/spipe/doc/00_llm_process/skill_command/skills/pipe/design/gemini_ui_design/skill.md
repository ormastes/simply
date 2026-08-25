<!-- llm-process-gen: managed source=pipe_design_gemini_ui_design_skill source_sha256=33319765f616be9b36e20936c133771a643bd2717cd567e3740fc00cd512d384 content_sha256=33319765f616be9b36e20936c133771a643bd2717cd567e3740fc00cd512d384 -->
# Gemini UI Design Skill — Step 3: TUI/GUI Design via Gemini + Stitch

Delegate GUI/TUI design to Gemini API. Gemini generates designs; Stitch MCP renders them.

## When to Use

- Feature needs GUI/TUI mockups or component design
- Cooperative pipeline Step 3 (after research + requirements)
- User asks for UI design, wireframes, or visual prototyping

## Prerequisites

| What | Check | Setup |
|------|-------|-------|
| Gemini API key | `echo $GEMINI_API_KEY` | `export GEMINI_API_KEY=<key>` |
| Stitch MCP | `.mcp.json` has `stitch` entry | `sh config/mcp/install.shs` |
| Stitch API key | `~/.security/env.sh` has `STITCH_API_KEY` | Create file with `export STITCH_API_KEY=<key>` |

## Workflow

### Phase 1: Gather Context

Read these files to build the design prompt:
- `doc/02_requirements/feature/<feature>.md` (requirements)
- `src/lib/common/ui/glass_tokens.spl` (glass design tokens — default style)
- `src/lib/common/ui/glass_theme.spl` (glass_dark / glass_light themes)
- `src/lib/common/ui/glass_css.spl` (CSS component patterns)
- `src/lib/common/ui/builder.spl` (available widget builders)

### Phase 2: Call Gemini API

Use `rt_process_run("curl", ...)` to call Gemini API with the design prompt.

**Prompt template:**
```
Design a professional GUI for <feature> using glassmorphism style.

Design system:
- Two themes: glass_dark (default) and glass_light
- Surfaces: semi-transparent rgba (0.72 primary, 0.52 secondary)
- Blur: backdrop-filter blur(20px surfaces, 40px modals, 24px nav)
- Borders: subtle translucent edges
- Dark: accent #0A84FF, text #F5F5F7, bg #0A0A0F
- Light: accent #007AFF, text #1D1D1F, bg #F0F0F5
- Radius: sm=8, md=12, lg=16, xl=20
- Font: system font stack

Requirements: <paste requirements>

Output:
1. HTML/CSS mockup with glass styling for each screen
2. Component list with props/states
3. Interaction flow (state transitions, navigation)
4. Both dark and light variants
```

### Phase 3: Stitch MCP — Generate Screens

Use the Stitch MCP tools to build production HTML from the design:

| Tool | Use |
|------|-----|
| `mcp__stitch__build_site` | Build full site from design description |
| `mcp__stitch__get_screen_code` | Get single screen HTML/CSS |

Pass Gemini's design output to Stitch for rendering.

### Phase 4: Convert to Simple

Convert Stitch HTML output to Simple `.spl` widget code:
- Map HTML elements to `builder.spl` functions (column, row, button, etc.)
- Apply glass tokens via `glass_tokens.spl` classes
- Create component files in `src/lib/common/ui/<feature>/`
- Create `__init__.spl` with exports

### Phase 5: Output

| Artifact | Location |
|----------|----------|
| GUI design doc | `doc/05_design/<feature>_gui.md` |
| TUI design doc | `doc/05_design/<feature>_tui.md` |
| HTML prototypes | `doc/05_design/<feature>_screens/` |
| Component code | `src/lib/common/ui/<feature>/` |
| Tests | `test/01_unit/lib/common/ui/<feature>_spec.spl` |

## Agent Reference

See `.claude/agents/ui-design.md` for the full UI Design agent spec with Stitch MCP tool details.

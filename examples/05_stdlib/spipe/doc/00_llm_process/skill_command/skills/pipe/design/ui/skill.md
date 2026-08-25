<!-- llm-process-gen: managed source=pipe_design_ui_skill source_sha256=8231c2d78b6d048c6e9d4365ca3f3d20676d146fd15f1cf31a41a7529ce4c1ef content_sha256=8231c2d78b6d048c6e9d4365ca3f3d20676d146fd15f1cf31a41a7529ce4c1ef -->
# UI Skill — TUI/GUI Mockup Design

## Prerequisites
| Artifact | Path | If missing |
|----------|------|-----------|
| Requirements | `doc/02_requirements/feature/<feature>.md` | Run `/research` first |
| Design system reference | `doc/05_design/stitch_design_system.md` | Extract from Stitch MCP |

## Stitch MCP — Google's AI UI Design Tool

**What it is:** Stitch is a Google MCP service that uses Gemini to generate HTML/CSS UI screens from text prompts. It manages design systems (colors, fonts, spacing, roundness) and generates desktop/mobile/tablet screens that follow those systems. Output is production-quality HTML+CSS.

**Key capabilities:**
- `create_design_system` / `update_design_system` — define color palette, fonts, roundness, spacing, and a free-form `designMd` markdown that teaches Gemini the visual language
- `generate_screen_from_text` — generate a full screen from a text prompt (1-3 min per screen)
- `edit_screens` — modify existing screens with focused prompts
- `generate_variants` — create layout/color/typography variants of existing screens
- `apply_design_system` — re-skin screens to match a design system
- `get_screen` — retrieve generated HTML/CSS code

**Design system reference:** All SimpleOS design systems (Obsidian dark, Celestial Ether light, Glass original) are documented with full token tables, component specs, and Stitch API configuration in:
> **[`doc/05_design/stitch_design_system.md`](doc/05_design/stitch_design_system.md)**

**Existing Stitch projects:**
- Project `12496218458601315145` — "Simple OS UI" (Obsidian + Celestial Ether design systems, 17 screens)
- Project `14134637940805933672` — "SimpleOS Glass" (original Glass design system, 19 screens)

**Start Stitch MCP (if not already loaded):**
```bash
STITCH_API_KEY="$STITCH_API_KEY" npx -y @_davideast/stitch-mcp proxy
```

## Theme Consistency Check

**Before generating new mockups:** run `/theme_sync diff` to verify local tokens match Stitch.
Drift will cause rendered mockups to disagree with the Electron shell.

```
bin/simple theme-sync dump-local --theme=obsidian --out=/tmp/local_obsidian.sdn
bin/simple theme-sync diff --local=/tmp/local_obsidian.sdn \
    --remote=doc/05_design/stitch_snapshots/12496218458601315145/design_systems/obsidian_active.sdn
```

If drift is detected, resolve it via `/theme_sync` before proceeding.

## Workflow

1. **TUI mockups** (box-drawing, ANSI colors): `doc/05_design/<feature>_tui.md`
2. **GUI mockups** (web patterns, responsive): `doc/05_design/<feature>_gui.md`
3. For Gemini GUI prototyping: start Stitch MCP, then use its tools
4. For theme consistency: read `doc/05_design/stitch_design_system.md` for tokens, components, and DO/DON'T rules
5. Present component lists to user for confirmation

Skip if feature has no UI component.

## Minimal Screen Set for Theme Validation

When creating a new theme, generate at minimum:
1. **Desktop / Launcher** — system bar, dock, gradient background
2. **Window Manager (3 windows)** — chrome, focus/inactive, overlapping shadows
3. **Settings Panel** — sidebar nav, cards, toggles, nested glass
4. **File Manager** — toolbar, sidebar, grid/list views, search

Full coverage (10 screens) documented in `stitch_design_system.md` Section 9.

## Outputs
| Artifact | Location |
|----------|----------|
| UI design (TUI) | `doc/05_design/<feature>_tui.md` |
| UI design (GUI) | `doc/05_design/<feature>_gui.md` |
| Design system ref | `doc/05_design/stitch_design_system.md` |

---

## Typed Widget Authoring

Phases 1-6 of the typed-core RFC (`doc/05_design/ui_typed_core_rfc.md`) replaced stringly-typed fields with enums and fluent helpers. Use these when constructing `WidgetNode` in Simple code.

### WidgetKind and LayoutKind (Phase 2)

`WidgetRecord.kind` and `WidgetRecord.layout` are now typed enums instead of `text`:

```simple
# Before (Phase 0 — string literals)
val node = WidgetNode(kind: "panel", layout: "column")

# After (Phase 2 — typed enums)
use std.ui.{WidgetNode, WidgetKind, LayoutKind}

val node = WidgetNode(kind: WidgetKind.Panel, layout: LayoutKind.Column)
```

`WidgetNode.kind_name()` and `.layout_name()` still return `text` for backwards-compatible wire serialisation. The codec boundary (`to_wire()` / `from_wire()`) on each enum handles conversion — application code never calls these directly.

### Design-Token Enums (Phase 4)

Five token enums live in `src/lib/common/ui/design_tokens.spl`:

| Enum | Example values |
|------|----------------|
| `Spacing` | `Xs`, `Sm`, `Md`, `Lg`, `Xl` |
| `Radius` | `None`, `Sm`, `Md`, `Lg`, `Full` |
| `Elevation` | `Flat`, `Raised`, `Floating`, `Overlay` |
| `SurfaceRole` | `Background`, `Card`, `Sheet`, `Overlay` |
| `TextRole` | `Body`, `Label`, `Heading`, `Caption` |

Pass them through the `ThemeRegistry` resolver:

```simple
use std.ui.{WidgetNode, Spacing, Radius, SurfaceRole, ThemeRegistry}

val theme = theme_registry().get(ThemeId.Obsidian)
var node = WidgetNode(kind: WidgetKind.Panel, layout: LayoutKind.Column)
node = node.padding(theme, Spacing.Md)
node = node.radius_token(theme, Radius.Lg)
node = node.surface_role(theme, SurfaceRole.Card)
```

### Typed Actions (Phase 5)

Define app-specific actions as enums implementing `IntoAction`:

```simple
use std.ui.action.{IntoAction, CommonAction}

enum AppAction:
    Save
    Discard
    OpenSettings

impl IntoAction for AppAction:
    fn into_action(self) -> text:
        match self:
            | AppAction.Save -> "save"
            | AppAction.Discard -> "discard"
            | AppAction.OpenSettings -> "open_settings"

var node = WidgetNode(kind: WidgetKind.Button, layout: LayoutKind.None)
node = node.on_typed_action(AppAction.Save)
```

The wire event `UIEvent.Action(name: text)` is preserved verbatim — `IntoAction` only affects the author side.

---

## Fluent Chain Patterns

Phase 3 of the typed-core RFC (`doc/05_design/ui_typed_core_rfc.md`) adds 26 fluent methods on `WidgetNode`. These mirror the existing `with_*` free-function helpers.

### Available Methods (representative sample)

| Method | Purpose |
|--------|---------|
| `.width(i64)` | Set fixed width in logical pixels |
| `.height(i64)` | Set fixed height in logical pixels |
| `.accent(text)` | Set accent colour (hex string) |
| `.label(text)` | Set widget label / display text |
| `.child(WidgetNode)` | Append a child node |
| `.on_typed_action(IntoAction)` | Attach typed action handler |
| `.padding(theme, Spacing)` | Apply spacing token as padding |
| `.radius_token(theme, Radius)` | Apply radius token |
| `.surface_role(theme, SurfaceRole)` | Apply surface role token |
| `.show_when_at_most(SizeClass)` | Responsive visibility (Phase 6) |
| `.responsive_layout(...)` | Switch layout per breakpoint (Phase 6) |

### Intermediate-var Pattern (required today)

`.claude/rules/language.md` states: **"Chained methods broken — use intermediate `var`"**

Write each method call on its own assignment:

```simple
var node = WidgetNode(kind: WidgetKind.Panel, layout: LayoutKind.Column)
node = node.width(320)
node = node.label("Settings")
node = node.surface_role(theme, SurfaceRole.Card)
node = node.padding(theme, Spacing.Lg)
node = node.child(header_node)
node = node.child(body_node)
```

Do NOT write chained form (currently broken at the compiler level):

```simple
# NOT YET WORKING — do not use
val node = WidgetNode(...)
    .width(320)
    .label("Settings")
    .surface_role(theme, SurfaceRole.Card)
```

### Migration Path

Once `doc/05_design/compiler_rfc_method_chain_fix.md` lands, the chain form above will compile. The intermediate-var form will continue to work unchanged — no migration needed when the fix ships.

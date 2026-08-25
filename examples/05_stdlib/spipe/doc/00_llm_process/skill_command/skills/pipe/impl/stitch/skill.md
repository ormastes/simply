<!-- llm-process-gen: managed source=pipe_impl_stitch_skill source_sha256=935888fc52070adb5c56e30d5cc60625554fb013575a888f4da4a5d33c591162 content_sha256=935888fc52070adb5c56e30d5cc60625554fb013575a888f4da4a5d33c591162 -->
# Stitch Skill -- Glassmorphism UI Screen Generation

Generate desktop OS UI screens via Google Stitch MCP with a macOS-inspired glassmorphism design system. All CSS patterns are license-free (standard glassmorphism, no proprietary assets).

## Prerequisites

| Artifact | Check | If Missing |
|----------|-------|------------|
| Stitch MCP | `.mcp.json` has `stitch` entry | Configure streamable-http transport |
| Stitch API key | `STITCH_API_KEY` env var | Get from stitch.withgoogle.com Settings |
| Glass tokens | `src/lib/common/ui/glass_tokens.spl` | Already exists |
| Glass numeric | `src/lib/common/ui/glass_numeric_tokens.spl` | Already exists |

## When to Use

- Generating UI mockups or visual prototypes for Simple OS
- Creating reference screens for new WM features
- Exploring design variants (layout, color, light/dark)
- Producing desktop-quality glassmorphism screenshots

## Design System Configuration

Derived from `glass_numeric_tokens.spl` and `glass_tokens.spl`:

```
displayName: "SimpleOS Glass"
colorMode: DARK
headlineFont: MANROPE
bodyFont: INTER
labelFont: SPACE_GROTESK
roundness: ROUND_TWELVE
customColor: "#0A84FF"
colorVariant: TONAL_SPOT
overridePrimaryColor: "#0A84FF"
overrideSecondaryColor: "#BB86FC"
overrideTertiaryColor: "#30D158"
overrideNeutralColor: "#1E1E23"
```

### Typography Scale

```json
{
  "display-lg": { "fontFamily": "Manrope", "fontSize": "34px", "fontWeight": "700", "lineHeight": "1.2", "letterSpacing": "-0.01em" },
  "display-md": { "fontFamily": "Manrope", "fontSize": "28px", "fontWeight": "700", "lineHeight": "1.25", "letterSpacing": "-0.01em" },
  "title-lg": { "fontFamily": "Manrope", "fontSize": "22px", "fontWeight": "600", "lineHeight": "1.3" },
  "title-md": { "fontFamily": "Manrope", "fontSize": "17px", "fontWeight": "600", "lineHeight": "1.35" },
  "body-lg": { "fontFamily": "Inter", "fontSize": "17px", "fontWeight": "400", "lineHeight": "1.5" },
  "body-md": { "fontFamily": "Inter", "fontSize": "15px", "fontWeight": "400", "lineHeight": "1.5" },
  "body-sm": { "fontFamily": "Inter", "fontSize": "13px", "fontWeight": "400", "lineHeight": "1.4" },
  "label-lg": { "fontFamily": "Space Grotesk", "fontSize": "13px", "fontWeight": "500", "lineHeight": "1.4" },
  "label-sm": { "fontFamily": "Space Grotesk", "fontSize": "11px", "fontWeight": "500", "lineHeight": "1.3", "letterSpacing": "0.02em" }
}
```

### Spacing Scale

```json
{ "xs": "4px", "sm": "8px", "md": "12px", "lg": "20px", "xl": "32px" }
```

**Token enums (typed-core Phase 4):** The spacing values above map directly to the `Spacing` enum (`Spacing.Xs`/`Sm`/`Md`/`Lg`/`Xl`). Co-located token enums `Radius`, `Elevation`, `SurfaceRole`, and `TextRole` live in `src/lib/common/ui/design_tokens.spl`. When authoring widget code, pass `Spacing.Md` (etc.) to fluent helpers instead of raw pixel strings — the `ThemeRegistry` resolver converts them. See `doc/05_design/ui_typed_core_rfc.md` Phase 4 for the full mapping.

## designMd (Glassmorphism CSS Rules)

This markdown is passed as the `designMd` field in `create_design_system`. It teaches the model the full glassmorphism design language:

```markdown
# SimpleOS Glassmorphism Design Language

## Core Principle
Every surface is a frosted glass pane floating over a deep-space gradient background.
No flat solid backgrounds. All surfaces use semi-transparent backgrounds with backdrop-filter blur.

## 5-Level Surface Hierarchy
Every UI element maps to exactly one surface level:
- **Surface 0 (bg)**: App background, solid #0b0d10, no blur, no shadow
- **Surface 1 (sidebar/title)**: rgba(255,255,255,0.04), blur(10px), subtle 1px shadow
- **Surface 2 (card/section)**: rgba(255,255,255,0.06), blur(12px), 4px shadow, radius 12px
- **Surface 3 (floating/palette)**: rgba(255,255,255,0.09), blur(16px), 8px shadow, radius 16px
- **Surface 4 (modal/spotlight)**: rgba(255,255,255,0.12), blur(20px), 12px dual shadow, radius 20px
Use CSS classes `.surface-0` through `.surface-4`. Higher level = more translucent + more blur + deeper shadow.

## Background
- Dark gradient from #060612 (top) to #1A0830 (bottom) -- deep space feel
- Light gradient from #C8B8E8 (top lavender) to #F0ECF5 (bottom soft white)

## Glass Surfaces (Dark Mode)
- Primary: rgba(30,30,35,0.72) with backdrop-filter: blur(20px)
- Secondary: rgba(40,40,48,0.52) with backdrop-filter: blur(20px)
- Tertiary: rgba(50,50,58,0.36) with backdrop-filter: blur(8px)
- Elevated (modals, popovers): rgba(44,44,50,0.88) with backdrop-filter: blur(40px)

## Glass Surfaces (Light Mode)
- Primary: rgba(255,255,255,0.72) with backdrop-filter: blur(20px)
- Secondary: rgba(255,255,255,0.52) with backdrop-filter: blur(20px)
- Tertiary: rgba(255,255,255,0.36) with backdrop-filter: blur(8px)
- Elevated: rgba(255,255,255,0.85) with backdrop-filter: blur(40px)

## CSS Custom Properties
- `--surface-0` through `--surface-4`: 5-level surface colors
- `--border`: rgba(255,255,255,0.10)
- `--text`: rgba(255,255,255,0.92)
- `--muted`: rgba(255,255,255,0.62)
- `--accent`: theme accent color
- `--radius-sm`: 12px, `--radius-md`: 16px, `--radius-lg`: 20px

## Borders
- Subtle: 1px solid rgba(255,255,255,0.08) -- barely visible glass edge
- Prominent: 1px solid rgba(255,255,255,0.18) -- active/focused elements
- Top edge highlight: 1px rgba(255,255,255,0.30) on top border for light-catch effect

## Shadows (multi-layer depth)
- Active windows: 9+ shadow layers creating realistic depth
- Layer pattern: wide soft (20px blur, low alpha) + blue tint + tight contact + bottom accent + ambient halo
- Inactive windows: 3 layers, reduced alpha

## Shell Components
- **Title bar** (`.shell-titlebar`): Surface 1, 38px, traffic light buttons, drag region, centered title
- **Sidebar** (`.shell-sidebar`): Surface 1, 220px, scrollable nav, translucent
- **Command palette** (`.shell-command-palette`): Surface 3, centered overlay, search input + result list, 520px wide
- **Dock** (`.shell-dock`): Surface 2, pill shape 26px radius, icon row with active indicators

## Window Chrome
- Title bar: 24px, glass surface with blur, traffic light buttons (close #FF5F57, minimize #FFBD2E, maximize #28CA41) on left
- Title text centered, 13px, secondary text color
- 12px corner radius on window frame

## System Bar (top, 28px)
- Full-width glass surface, blur(24px), nav-grade
- Left: Logo + active app name + menu items (File, Edit, View, Go, Window)
- Right: Search icon, Control Center, Wi-Fi, battery %, volume, clock
- Bottom separator: 1px border with accent color undertone

## Dock (bottom)
- Pill-shaped glass container, 58px tall, 26px corner radius
- Icons: 40px with 48px pill background, 16px gap
- Magnification on hover (scale 1.0 to 1.5)
- Bounce animation for launching apps
- Active indicator: 4px dot below icon
- Apps: Terminal, Files, Calculator, Clock, Settings, Browser, Editor

## Interaction Pieces
- **Toast / snackbar** (`.glass-toast`): Surface 3, fade+rise animation (260ms)
- **Modal** (`.glass-modal`): Surface 4, scale-up entry, overlay backdrop-blur
- **Context menu** (`.glass-context-menu`): Surface 3, hover-highlight items, separator dividers
- **Inspector** (`.glass-inspector`): Surface 2, right panel, scrollable
- **Status chips** (`.glass-status-chip`): Pill shape, semantic color variants (success/warning/error)

## Visual Effects
- `.glass`: Starter glass panel (surface 2, blur 20px, dual shadow, border, radius 20px)
- `.glass-hairline`: 1px bright top edge
- `.glass-inset-highlight`: Soft inner top light
- `.glass-dual-shadow`: Outer shadow + inner highlight
- `.glass-accent-glow`: Active-item accent glow via color-mix()
- `.glass-noise`: 1-2% opacity fractal noise overlay (::after pseudo)
- `.glass-hover-lift`: translateY(-2px) + shadow increase on hover (150ms)
- `.glass-pressed`: Inner shadow + scale(0.98) on :active
- `.glass-focus-ring`: 2px accessible accent outline
- `.glass-scrollbar`: Thin translucent scrollbar (scrollbar-width/color)

## Motion System
- **Hover**: 120-160ms (`.motion-hover`, 150ms)
- **Panel open/close**: 180-240ms (`.motion-panel`, 220ms)
- **Modal / sheet**: 220-300ms (`.motion-modal`, 260ms)
- Sidebar collapse: opacity + width + slight blur
- List selection: pill slide, not bounce
- Notification: fade + 6-10px rise
- Page change: crossfade + small content shift
- `@media (prefers-reduced-motion: reduce)`: All transitions/animations set to 0.01ms

## Typography
- System font stack, 15px base body size
- Headline weight: 600-700, body weight: 400, label weight: 500
- Text primary: #F5F5F7 (dark) / #1D1D1F (light)
- Text secondary: rgba(235,235,245,0.6) (dark) / rgba(60,60,67,0.6) (light)

## Colors
- Accent: #0A84FF (iOS blue)
- Secondary accent: #BB86FC (purple)
- Semantic: error #FF453A, warning #FF9F0A, success #30D158, info #64D2FF

## Interactions
- Hover: border transitions to prominent, shadow upgrades by one tier
- Active: scale(0.98) press effect
- Focus: 3px accent-color ring with 0.2 alpha
- Transitions: 150ms fast, 300ms normal, cubic-bezier(0.4, 0.0, 0.2, 1.0)

## Layout Patterns
- Flex layout with spacers
- Cards with glass surface + subtle border + small shadow
- Lists with hover-highlight rows
- Sidebars: secondary glass surface, 200-240px wide
- Toolbars: primary glass surface with nav blur

## Anti-Patterns (DO NOT)
- Full-window fake transparency
- Blur behind body text blocks
- More than one strong accent color
- Heavy neon glows on every control
- Many border radii (use 12/16/20 scale only)
- Bouncy animation everywhere
- Bright gradients behind dense tables
- Ultra-thin low-contrast text
- Use flat solid colored backgrounds
- Use sharp corners (minimum 8px radius)
- Use heavy drop shadows without blur
- Use bright white or pure black surfaces
- Forget the gradient background behind all glass layers
```

## Workflow

### Phase 1: Create Project
```
mcp__stitch__create_project(title: "SimpleOS Glass UI")
```

### Phase 2: Create Design System
```
mcp__stitch__create_design_system(
  projectId: "<id>",
  designSystem: {
    displayName: "SimpleOS Glass",
    theme: { <all config above + designMd + typography + spacing> }
  }
)
```
Then `update_design_system` to activate.

### Phase 3: Generate Screens
Use `generate_screen_from_text` with curated prompts below. Always:
- `deviceType: "DESKTOP"`
- `modelId: "GEMINI_3_1_PRO"`
- One screen at a time (each takes 1-3 min, do NOT retry)

### Phase 4: Apply Design System
```
mcp__stitch__apply_design_system(projectId, assetId, selectedScreenInstances)
```
Get instance IDs from `get_project` first.

### Phase 5: Variants
```
mcp__stitch__generate_variants(
  creativeRange: "REFINE",
  aspects: ["COLOR_SCHEME"],
  variantCount: 2
)
```

### Post-generation: Snapshot Stitch state

**After generating screens:** run `/theme_sync pull` to snapshot the new Stitch state.
This keeps `doc/05_design/stitch_snapshots/` in sync with what was just created in the cloud.

```
# Invokes Phase 1 of the theme_sync skill
/theme_sync pull
```

Snapshots land under `doc/05_design/stitch_snapshots/<project_id>/`. Commit the updated SDN files.

## Screen Prompt Templates

### Desktop / Launcher
```
Design a macOS-inspired desktop OS home screen with glassmorphism 5-level surface system.

Background: Surface 0 -- solid #0b0d10 with deep space gradient overlay from #060612 (top) to #1A0830 (bottom).

Top system bar (28px tall, Surface 1): rgba(255,255,255,0.04), blur(10px). Shows logo left, app name "Finder", menu items (File, Edit, View, Go, Window, Help) in 13px text. Right side: search icon, control center grid icon, Wi-Fi icon, battery "97%", volume icon, clock "9:41 AM". 1px bottom border rgba(255,255,255,0.10).

Main desktop area: Surface 0 background showing through. Optional: 2-3 desktop file/folder icons in a grid aligned to top-right.

Bottom dock (Surface 2): rgba(255,255,255,0.06), blur(12px), pill shape 26px radius. Contains 7 app icons as rounded squares (40px): Terminal (blue), Files (green), Calculator (red), Clock (orange), Settings (purple), Browser (orange), Editor (teal). Active dot indicator below Terminal.

Surface hierarchy: system bar = Surface 1, desktop = Surface 0, dock = Surface 2. Radius scale: 12/16/20px only. Borders rgba(255,255,255,0.10). Dark mode text rgba(255,255,255,0.92).
```

### Window Manager (3 Windows)
```
Design a desktop OS window manager showing 3 overlapping glassmorphism windows on a 5-level surface system.

Background: Surface 0 (#0b0d10) with deep space gradient overlay (#060612 to #1A0830).

System bar at top (Surface 1): blur(10px), 28px, "Editor" app name, File/Edit/View menus, clock and status icons right.

Window 1 (focused, front, Surface 2): "Editor" window, 500x350px. Title bar (Surface 1) with traffic lights (red #FF5F57, yellow #FFBD2E, green #28CA41). Body shows code editor with syntax highlighting on Surface 2. Glass dual-shadow + hairline border.

Window 2 (behind, left, Surface 2): "Terminal" window, 450x300px. Green prompt "simpleos$", command output. Inactive state (dimmed). Reduced shadow.

Window 3 (behind, right, Surface 2): "File Manager", 400x280px. Sidebar (Surface 1) with folder list, main area (Surface 0) with file grid. Inactive state.

Bottom dock (Surface 2): Glass pill 26px radius, 7 app icons, Terminal and Editor active indicators.

Surface hierarchy: bg=0, system bar/sidebar/titlebar=1, windows/cards/dock=2, floating panels=3, modals=4. Radius: 12/16/20px. Border: rgba(255,255,255,0.10). Motion: hover 150ms, panel 220ms.
```

### Settings Panel
```
Design a macOS-style System Settings panel using the 5-level surface hierarchy.

Background: Surface 0 (#0b0d10) with deep space gradient overlay.

System bar at top (Surface 1): blur(10px), "Settings" app name.

Settings window (600x450px, centered, Surface 2): blur(12px), 12px radius, traffic lights, "Settings" title.

Left sidebar (200px, Surface 1): Navigation list: "General" (selected, accent highlight), "Appearance", "Display", "Sound", "Network", "Bluetooth", "Keyboard", "Mouse", "Storage". 36px items. Thin scrollbar.

Right content (Surface 0): Card-based layout:
- Card 1 (Surface 2): "About This Computer" -- SimpleOS v1.0, processor, memory
- Card 2 (Surface 2): "Appearance" toggle -- Dark/Light with preview circles
- Card 3 (Surface 2): "Desktop & Dock" -- Dock size slider, magnification toggle
Each card: 12px radius, glass-hover-lift effect.

Bottom dock (Surface 2): Glass pill, Settings active indicator.

Surface levels: bg=0, sidebar/titlebar=1, window/cards=2. Radius 12/16/20. Border rgba(255,255,255,0.10). Use .glass-hover-lift on cards, .glass-scrollbar on sidebar.
```

### File Manager
```
Design a macOS Finder-style file manager using the 5-level surface hierarchy.

Background: Surface 0 (#0b0d10) with deep space gradient overlay.

System bar (Surface 1): "Finder" with File/Edit/View/Go menus, blur(10px).

File Manager window (550x400px, Surface 2): blur(12px), traffic lights, "Documents".

Toolbar (40px, Surface 1): Back/forward arrows, view mode toggles, search field (glass input, 12px radius).

Left sidebar (180px, Surface 1): Scrollable, glass-scrollbar.
- "Favorites": Desktop, Documents (selected, accent), Downloads, Applications
- "Locations": SimpleOS HD, Network
- "Tags": Red, Blue, Green, Orange circles

Main content (Surface 0): 4x3 grid of items with glass-hover-lift:
- Folders: Projects, Photos, Music, Code (colored icons)
- Files: readme.txt, image.png, notes.md, config.spl
Each: 48px icon + name + file size (--muted color).

Status bar (24px, Surface 1): "8 items, 2.3 GB available".

Bottom dock (Surface 2): Active Files indicator.

Surface mapping: bg=0, sidebar/toolbar/statusbar=1, window/cards=2, command palette=3, modal=4. Glass effects: hover-lift on grid items, scrollbar on sidebar. Radius 12/16/20 only.
```

## Critical Rules

1. Always use `GEMINI_3_1_PRO` -- highest quality output
2. Always `deviceType: "DESKTOP"` for all screens
3. Create design system BEFORE generating screens
4. After `create_design_system`, call `update_design_system` to activate
5. One screen at a time -- each takes 1-3 min, do NOT retry on timeout
6. Use `edit_screens` for small focused changes, never full rewrites
7. The `designMd` field is the most powerful quality lever
8. For light mode: use `generate_variants` with `aspects: ["COLOR_SCHEME"]`
9. All colors from `glass_tokens.spl` / `glass_numeric_tokens.spl`
10. No license issues -- all CSS glassmorphism is open standard

## Related Documentation

- **Full design system reference:** [`doc/05_design/stitch_design_system.md`](doc/05_design/stitch_design_system.md) — all 3 design systems with complete token tables, Material Design 3 named colors, component specs, interaction states, and Stitch API configuration
- **UI skill:** `.claude/skills/ui.md` — workflow for TUI/GUI mockup design, explains what Stitch is and how to use it
- **Local glass tokens:** `src/lib/common/ui/glass_tokens.spl` (CSS), `glass_numeric_tokens.spl` (u64 baremetal)
- **Theme sharing:** GUI lib uses CSS tokens, window manager uses numeric tokens, Stitch uses designMd — all must stay in sync

## Outputs

| Artifact | Location |
|----------|----------|
| Stitch project | Cloud (project ID in output) |
| Design system | Cloud (asset ID in output) |
| Screen designs | Stitch cloud (screen IDs in output) |
| Screen code | `mcp__stitch__get_screen` to retrieve |
| Design system doc | `doc/05_design/stitch_design_system.md` |

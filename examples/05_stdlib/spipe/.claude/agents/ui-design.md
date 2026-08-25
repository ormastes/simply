# UI Design Agent — Stitch MCP Integration

## MCP Servers

This agent requires the following MCP server (not loaded by default — enable when spawning UI design tasks):

```json
{
  "stitch": {
    "command": "bash",
    "args": [
      "-lc",
      "if [ -f ~/.security/env.sh ]; then . ~/.security/env.sh; fi; exec npx -y @_davideast/stitch-mcp proxy"
    ],
    "cwd": "."
  }
}
```

**Enable before use:** Add to `.mcp.json` or run `claude mcp add` when working on UI design tasks.

**Use when:** Designing UI screens, generating HTML/CSS components, creating layouts, prototyping interfaces, or converting design descriptions into production-ready HTML.

**Skills:** `/design`

## Stitch MCP Tools

This agent uses Google Stitch via the `stitch` MCP server (proxied through `@_davideast/stitch-mcp`) to generate, retrieve, and sync UI designs.

### Available MCP Tools

Read-only (pull / inspect):

| Tool | Purpose |
|------|---------|
| `mcp__stitch__list_projects` | List all Stitch projects (filter: `view=owned` or `view=shared`) |
| `mcp__stitch__get_project` | Fetch a project by resource name (`projects/<id>`) — returns full designTheme + screen list |
| `mcp__stitch__list_design_systems` | List design systems for a project |
| `mcp__stitch__get_screen` | Fetch a screen's HTML/CSS code — requires resource name `projects/<pid>/screens/<sid>` |

Mutating (create / update / generate):

| Tool | Purpose |
|------|---------|
| `mcp__stitch__create_project` | Bootstrap a new Stitch project |
| `mcp__stitch__create_design_system` | Attach a new design system to a project |
| `mcp__stitch__update_design_system` | Replace an existing design system (full rewrite, not patch) |
| `mcp__stitch__apply_design_system` | Re-skin selected screens with a design system |
| `mcp__stitch__generate_screen_from_text` | Generate a new screen from a prompt (1–3 min; use `GEMINI_3_1_PRO`, `deviceType: DESKTOP`) |
| `mcp__stitch__edit_screens` | Focused prompt-based edits of existing screens (no raw HTML push) |
| `mcp__stitch__generate_variants` | Color / layout / typography variants for screens |

### Known Projects

| ID | Title | Active theme | Asset IDs |
|----|-------|--------------|-----------|
| `12496218458601315145` | Simple OS UI | SimpleOS Obsidian (FIDELITY, ROUND_EIGHT) | `fafd2be98b5d434ca0d9ab6c3c5d2598` (Obsidian), `8fe8c918253a418db456fc51badcaffe` (Celestial Ether) |
| `14134637940805933672` | Simple OS UI | SimpleOS Glass (TONAL_SPOT, ROUND_TWELVE) | `365508527354896466` |

Snapshot: `doc/05_design/stitch_snapshots/` (pulled 2026-04-12, mode `reconcile`).

### Workflow

1. **Describe** — User provides a UI description or theme change request
2. **Pull baseline** — `list_projects` then `get_project` for each known ID; save results under `doc/05_design/stitch_snapshots/`
3. **Generate or edit** — `generate_screen_from_text` for new screens, `edit_screens` for focused changes
4. **Retrieve code** — `get_screen` returns HTML/CSS
5. **Integrate** — place generated HTML into the project or sync tokens into `src/lib/common/ui/glass_tokens.spl`
6. **Refine** — iterate on feedback; re-apply design system via `apply_design_system`

### Caveats

- **No raw HTML push-back.** `edit_screens` takes a natural-language prompt, not code. Local HTML edits cannot be round-tripped.
- **Design systems are atomic.** `update_design_system` replaces the whole object — not a per-field patch.
- **Screen generation is slow.** Each `generate_screen_from_text` takes 1–3 minutes. Do not retry on timeout — check with `get_project` first.

### Environment

- **API Key:** `STITCH_API_KEY` — loaded from `.security/env.sh` (never committed)
- **MCP Server:** `stitch` entry in `.mcp.json` — runs `@_davideast/stitch-mcp proxy`

### Design Guidelines

- Generate clean, semantic HTML with minimal inline styles
- Prefer CSS classes over inline styles for reusability
- Use responsive design patterns (flexbox/grid)
- Keep accessibility in mind (ARIA labels, semantic tags, contrast)
- When integrating with Simple projects, output to `.spl` web templates or standalone HTML

### Example Prompts

```
"Design a dashboard with sidebar nav, metrics cards, and a chart area"
"Create a login page with email/password fields and social auth buttons"
"Build a settings page with toggle switches and a save button"
```

### File Locations

| What | Where |
|------|-------|
| Stitch MCP config | `.mcp.json` (stitch entry) |
| API key | `.security/env.sh` |
| Web app templates | `src/app/web/` |
| Example outputs | `examples/` |
| Design docs | `doc/05_design/` |

<!-- llm-process-gen: managed source=pipe_design_theme_sync_skill source_sha256=911afa3f9b83ffd4549ebbd69107de2b5a2ea05e3523a310aacca945521ac5a0 content_sha256=911afa3f9b83ffd4549ebbd69107de2b5a2ea05e3523a310aacca945521ac5a0 -->
# Theme Sync Skill — Round-trip between Local Tokens and Stitch

Synchronize the Simple OS glassmorphism design system between local `.spl` token files and live Stitch cloud design systems. Detects token drift, resolves conflicts, pushes updates to Stitch, and validates results with rendered screenshots.

Full background and architecture decisions are in the approved plan: `/Users/ormastes/.claude/plans/federated-rolling-owl.md`.

## Prerequisites

| Artifact | Check | If Missing |
|----------|-------|------------|
| Stitch MCP | `.mcp.json` has `stitch` entry | Configure streamable-http transport |
| Stitch API key | `STITCH_API_KEY` env var | Get from stitch.withgoogle.com Settings |
| Glass tokens | `src/lib/common/ui/glass_tokens.spl` | Already exists — Phase 1 of plan extends it |
| Stitch snapshots | `doc/05_design/stitch_snapshots/` | Run Phase 1 (Pull) below |
| Sync mode flag | `doc/05_design/stitch_snapshots/sync_mode.sdn` | Created by Phase 0 baseline pull; initial value: `reconcile` |
| theme-sync CLI | `bin/simple theme-sync` subcommand | Phase 2 of plan adds this |

## When to Use

- Checking whether local token files have drifted from the live Stitch design systems
- Pushing updated local tokens to Stitch (steady-state, after first reconciliation)
- Capturing a fresh snapshot of Stitch state after screen generation
- Reconciling conflicting values between local `.spl` sources and Stitch cloud state (one-time, initial run)

## Known Project IDs

| Project | ID | Active design system |
|---------|-----|----------------------|
| Simple OS UI (Obsidian) | `12496218458601315145` | `obsidian_active.sdn` |
| Simple OS UI (Glass) | `14134637940805933672` | `glass_active.sdn` |

## Workflow

### Phase 1 — Pull (snapshot Stitch state)

Refresh local snapshots from the live Stitch API.

```
projects = mcp__stitch__list_projects()
for p in projects:
    detail = mcp__stitch__get_project(project_id=p.id)
    write doc/05_design/stitch_snapshots/<p.id>/project.sdn
    ds_list = mcp__stitch__list_design_systems(project_id=p.id)
    for ds in ds_list:
        write doc/05_design/stitch_snapshots/<p.id>/design_systems/<ds.id>.sdn
write doc/05_design/stitch_snapshots/last_pull.sdn  { pulled_at: <iso-date>, tool_version: "theme-sync/0.1" }
```

Snapshots are committed under `doc/05_design/stitch_snapshots/` (SDN format per project rules).

### Phase 2 — Diff (detect token drift)

For each theme in `{obsidian, glass}`:
```
bin/simple theme-sync dump-local --theme=<t> --out=/tmp/local_<t>.sdn
bin/simple theme-sync diff --local=/tmp/local_<t>.sdn \
    --remote=doc/05_design/stitch_snapshots/<project_id>/design_systems/<ds_id>.sdn
```

Capture combined output to `doc/05_design/stitch_snapshots/last_diff.txt` (not committed). Exit code 0 = clean, 2 = drift detected. Stop here if only reporting.

Drift categories: `TYPOGRAPHY`, `SHAPE`, `COLOR (named)`, `COLOR (overrides)`, `SPACING`, `METADATA`.

### Phase 3 — Decide (resolve conflict per drifting field)

**First action:** read `doc/05_design/stitch_snapshots/sync_mode.sdn`.

**If `mode: reconcile`** (initial state — one-time reconciliation pass):
- Present a per-field drift prompt for each drifting row:
  ```
  body_font   local=MANROPE   remote=INTER   → [Stitch-wins] / [Local-wins] / [skip]
  ```
- Accumulate decisions in memory (not written to disk).
- `reconcile` is the mode set during Phase 0 baseline pull. Once all drifts are verified and local tokens updated, the user manually changes `sync_mode.sdn` to `push_only`.

**If `mode: push_only`** (steady state after reconciliation is complete):
- Auto-select `[Local-wins]` for every drifting field.
- Show a single confirmation: `"Push <N> drifts to Stitch? [y/n]"`.

### Phase 4 — Push (local wins only)

Executes for all fields where `[Local-wins]` was chosen (either manually in reconcile mode, or automatically in push_only mode).

The push flow is a **two-step handoff**: the Simple CLI builds a pending payload file, then this skill session reads it and dispatches the MCP calls. The CLI never makes network calls.

```
1. Confirm mode: read doc/05_design/stitch_snapshots/sync_mode.sdn
   If mode != push_only: STOP with message
       "run /theme_sync reconcile first, then flip sync_mode.sdn"

2. For each drift-flagged design system from Phase 2 diff output:
   bin/simple theme-sync build-push-payload \
       --project=<pid> --design-system=<asset_id> --local=/tmp/local_<theme>.sdn
   # Default output: doc/05_design/stitch_snapshots/<pid>/_pending_update_<asset_id>.sdn
   # Override with --out=<path> if needed.

3. For each generated pending file <pid>/_pending_update_<asset_id>.sdn:
   - Read the SDN (flat field layout, ends with `design_md: |` block)
   - Parse each root-level field: display_name, color_mode, headline_font,
     body_font, label_font, roundness, color_variant, custom_color,
     spacing_scale, override_primary_color, override_secondary_color,
     override_tertiary_color, override_neutral_color, named_colors (map),
     and the multi-line design_md body
   - Call mcp__stitch__update_design_system(
         project_id=pid,
         design_system_id=asset_id,
         display_name=..., color_mode=...,
         headline_font=..., body_font=..., label_font=...,
         roundness=..., color_variant=..., custom_color=...,
         spacing_scale=...,
         override_primary_color=..., override_secondary_color=...,
         override_tertiary_color=..., override_neutral_color=...,
         named_colors={...},
         design_md=<full multi-line body>
     )
   - On success: mcp__stitch__apply_design_system(
         project_id=pid, design_system_id=asset_id
     )  # re-skins all screens in the project
   - Delete the pending file

4. Re-pull and diff: Phase 1 pull → Phase 2 diff must return exit 0 (clean)

5. Render & verify via render-wm/render-app (optional side-by-side visual)
```

`edit_screens` is NOT called — `apply_design_system` handles reskinning wholesale.

**If `reconcile` mode and any field has `[Stitch-wins]`:** skip push for that design system. Tell the user to patch `glass_tokens.spl` manually with the winning Stitch values, verify locally, then flip `sync_mode.sdn` to `push_only` before running the next sync cycle.

### Phase 5 — Render and verify

Generate visual evidence that local rendering matches Stitch cloud screens.

```
bin/simple theme-sync render-wm --theme=<t> --out=doc/05_design/stitch_snapshots/last_verify/wm_<t>.png
bin/simple theme-sync render-app --theme=<t> --out=doc/05_design/stitch_snapshots/last_verify/app_<t>.html
```

Note: `render-wm` and `render-app` are stubs until project Phase 4 lands the rendering wrappers. They exit 0 and emit a placeholder PNG/HTML. For a live Stitch-side visual check, use `mcp__stitch__get_screen` on known screen IDs from Phase 1 snapshots.

Output directory: `doc/05_design/stitch_snapshots/last_verify/` (not committed; review locally via `open last_verify/index.html`).

## MCP Tools Referenced

| Tool | Phase | Purpose |
|------|-------|---------|
| `mcp__stitch__list_projects` | 1 | Enumerate all Stitch projects |
| `mcp__stitch__get_project` | 1 | Pull full project detail + screen list |
| `mcp__stitch__list_design_systems` | 1 | List design systems per project |
| `mcp__stitch__update_design_system` | 4 | Push updated token payload |
| `mcp__stitch__apply_design_system` | 4 | Re-skin project screens after token push |
| `mcp__stitch__get_screen` | 5 | Fetch Stitch-rendered screen HTML for visual comparison |

## Sync Mode Reference

| Value | Meaning | Set by |
|-------|---------|--------|
| `reconcile` | Initial state. Per-field prompts. Either side can win. | Phase 0 baseline pull |
| `push_only` | Steady state. Local always wins. | User, manually after first reconciliation verified |

To flip: edit `doc/05_design/stitch_snapshots/sync_mode.sdn` and change `mode: reconcile` to `mode: push_only`.

## Related Files

- **Plan:** `/Users/ormastes/.claude/plans/federated-rolling-owl.md` — full architecture and phased execution plan
- **Local tokens:** `src/lib/common/ui/glass_tokens.spl` — canonical source; `StitchDesignSystem.obsidian()` / `StitchDesignSystem.glass()`
- **Stitch snapshots:** `doc/05_design/stitch_snapshots/` — SDN files for all projects + design systems
- **Sync mode flag:** `doc/05_design/stitch_snapshots/sync_mode.sdn`
- **Stitch skill:** `.claude/skills/stitch.md` — screen generation; contains the canonical `designMd` injected at push time
- **UI skill:** `.claude/skills/ui.md` — mockup workflow; includes theme-sync diff pre-check
- **Typed-core token enums:** `src/lib/common/ui/design_tokens.spl` — `Spacing`, `Radius`, `Elevation`, `SurfaceRole`, `TextRole` enums (Phase 4 of `doc/05_design/ui_typed_core_rfc.md`). When diffing tokens, these enum references are the canonical local source; the Stitch snapshot stores the resolved raw values they map to.

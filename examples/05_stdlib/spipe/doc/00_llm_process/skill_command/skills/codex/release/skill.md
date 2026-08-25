<!-- llm-process-gen: managed source=codex_release_skill source_sha256=3d68961d63bc7661657f37fcf006fd8ba9990dfa5e64bcde7f06662736755a7d content_sha256=5768dc8cf053a260fc589004b44f7b1af24bd0bc4278317abde464b108b89ae1 -->
---
name: release
description: "Codex release skill. Version bump (major/minor/patch/exact), CHANGELOG update, commit, tag, push (ask before push). Prerequisite: verify PASS."
---

# Release — Codex Version Bump and Tag

**Cooperative Phase:** Release (after verification passes)
**Self-sufficient.** Can be run by any LLM independently.

## Tools

- **Simple MCP** — read/write project files

## Usage

- No args or `patch`/`third`: bump patch (0.9.3 -> 0.9.4)
- `minor`/`second`: bump minor (0.9.3 -> 0.10.0)
- `major`/`first`: bump major (0.9.3 -> 1.0.0)
- `X.Y.Z`: set exact version

## Prerequisite

Run `verify` skill first — must show **STATUS: PASS**.

Do NOT proceed with release if verification has any FAIL items.
SPipe/manual evidence, lower-model sidecar review, and workflow/tooling/
evidence/spec/verification contract docs must already be complete from verify.
Release must not create or update SPipe specs, repair generated-manual quality,
accept sidecar-review gaps, or repair stale `doc/07_guide`, `doc/06_spec`,
`.codex/skills`, `.agents/skills`, `.claude/skills`, `.claude/agents/spipe`,
or `.gemini/commands` instructions. Before proceeding, confirm
`find doc/06_spec -name '*_spec.spl' | wc -l` returns `0`.

## Steps

### 1. Read Current Version
Read from `simple.sdn` (field `project.version`).

### 2. Calculate New Version
Apply bump rule (major/minor/patch) or use exact version.

### 3. Update All Version Locations

| File | Field/Pattern |
|------|---------------|
| `simple.sdn` | `version: X.Y.Z` |
| `VERSION` | Entire file content |
| `src/app/cli/main.spl` | Hardcoded fallback in `get_version()` |
| `src/app/cli/bootstrap_main.spl` | Hardcoded in `bootstrap_version()` |

### 4. Update CHANGELOG

Add new section to `CHANGELOG.md`:

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- <new features>

### Changed
- <modifications>

### Fixed
- <bug fixes>
```

Populate from recent commits since last release tag.

### 5. Commit

```bash
jj commit -m "chore: release vX.Y.Z"
```

Or if jj unavailable:
```bash
git add -A && git commit -m "chore: release vX.Y.Z"
```

### 6. Tag

```bash
git tag -a vX.Y.Z -m "Release vX.Y.Z"
```

### 7. Push (ASK FIRST)

**Do NOT push without user approval.**

Ask: **"Ready to push vX.Y.Z to remote? (y/n)"**

If approved:
```bash
jj bookmark set main -r @- && jj git push --bookmark main
git push --tags
```

## Artifacts Produced

| Artifact | Path |
|----------|------|
| Updated version | `simple.sdn`, `VERSION`, `src/app/cli/main.spl`, `src/app/cli/bootstrap_main.spl` |
| Changelog | `CHANGELOG.md` |
| Git tag | `vX.Y.Z` |

## Rules

- NEVER release without verify PASS
- NEVER push without user approval
- NEVER skip version locations — all 4 files must be updated
- All code in `.spl` — no Python, no Bash

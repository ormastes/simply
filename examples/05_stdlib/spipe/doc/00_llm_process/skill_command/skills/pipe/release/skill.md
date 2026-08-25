<!-- llm-process-gen: managed source=pipe_release_skill source_sha256=8101a3f942cf7248127ec5931807a5fd55425fb7bfb11ea1aedfaa70a7a6551b content_sha256=861814efcb71cb4d3344e56009aaefefe93af4452886d06d8ca671c9faff85da -->
# Release Skill

Perform a version bump and release of the Simple Language compiler.

## Usage

```
/release              # patch bump (default): 0.9.2 → 0.9.3
/release patch        # same as above
/release third        # same as above
/release minor        # minor bump: 0.9.2 → 0.10.0
/release second       # same as above
/release major        # major bump: 0.9.2 → 1.0.0
/release first        # same as above
/release 1.0.0        # set exact version
```

## Procedure

Given argument: `$ARGUMENTS`

Prerequisite: `/verify` must show `STATUS: PASS`. SPipe/manual evidence,
lower-model sidecar review, and workflow/tooling/evidence/spec/verification
contract docs must already be complete from verify. Release must not create or
update SPipe specs, repair generated-manual quality, accept sidecar-review gaps,
or repair stale `doc/07_guide`, `doc/06_spec`, `.codex/skills`,
`.agents/skills`, `.claude/skills`, `.claude/agents/spipe`, or
`.gemini/commands` instructions. Before proceeding, confirm
`find doc/06_spec -name '*_spec.spl' | wc -l` returns `0`.

### Step 1 — Determine new version

1. Read current version from `simple.sdn` (field `project.version`, line 6)
2. Parse argument:
   - Empty, `patch`, or `third` → increment patch (Z+1)
   - `minor` or `second` → increment minor (Y+1), reset patch to 0
   - `major` or `first` → increment major (X+1), reset minor and patch to 0
   - Pattern `X.Y.Z` (digits.digits.digits) → use as-is
   - Anything else → error, show usage
3. Print: `Version bump: {old} → {new}`

### Step 2 — Update all version locations

Update these 4 files with the new version:

| File | What to change |
|------|---------------|
| `simple.sdn` | `version: X.Y.Z` (line 6) |
| `VERSION` | Entire file content: `X.Y.Z\n` |
| `src/app/cli/main.spl` | Hardcoded fallback string `"X.Y.Z"` in `get_version()` |
| `src/app/cli/bootstrap_main.spl` | Hardcoded string `"X.Y.Z"` in `bootstrap_version()` |

### Step 3 — Update CHANGELOG

Insert a new section at the top of `CHANGELOG.md` (after the `# Changelog` header and description line):

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added

### Fixed

### Changed
```

Use today's date. Keep existing entries below.

### Step 4 — Commit

```bash
jj commit -m "chore: release vX.Y.Z"
```

### Step 5 — Tag

```bash
git tag -a vX.Y.Z -m "Release vX.Y.Z"
```

### Step 6 — Ask before push

Show the user what will happen and ask for confirmation before running:

```bash
jj bookmark set main -r @- && jj git push --bookmark main
git push origin vX.Y.Z
```

Do NOT push without explicit user approval.

---

## Release Types

| Type | Format | Example |
|------|--------|---------|
| Stable | `vX.Y.Z` | `v1.0.0` |
| RC | `vX.Y.Z-rc.N` | `v1.0.0-rc.1` |
| Beta | `vX.Y.Z-beta.N` | `v1.0.0-beta.1` |
| Alpha | `vX.Y.Z-alpha.N` | `v1.0.0-alpha.1` |

## Pre-Release Checklist

- [ ] `bin/simple test` passing
- [ ] `bin/simple lint <changed .spl files>` clean
- [ ] `bin/simple todo-scan` — no critical TODOs
- [ ] Local bootstrap build works (3-stage)
- [ ] No orphan jj commits (`jj log` shows clean history)

## GitHub Actions Release Pipeline

Triggered by: git tag `v*.*.*` push or `workflow_dispatch` (manual).

| Job | What | Platforms |
|-----|------|-----------|
| `check-version` | Detect version from `simple.sdn` | ubuntu |
| `llvm-cross` | LLVM cross-compilation prep | reusable workflow |
| `build-bootstrap` | Build per-platform packages | 13 platforms |
| `build-full` | Full source+binary package | ubuntu |
| `create-release` | GitHub Release with assets | ubuntu |
| `publish-ghcr` | Publish to GHCR via ORAS | ubuntu |

## Post-Release

```bash
# Monitor
gh run list --workflow=release.yml --limit 3
gh run watch <run-id>
# Verify
gh release view vX.Y.Z
```

## Apply Release Binary Locally

```bash
gh release download vX.Y.Z --pattern "*-darwin-arm64.spk" --dir /tmp
cd /tmp && tar xzf simple-bootstrap-*-darwin-arm64.spk
cp simple-bootstrap-*/bin/simple ~/simple/bin/release/aarch64-apple-darwin-macho/simple
chmod +x ~/simple/bin/release/aarch64-apple-darwin-macho/simple
bin/simple --version
```

## Rollback

```bash
gh release delete vX.Y.Z --yes
git tag -d vX.Y.Z
git push origin :refs/tags/vX.Y.Z
```

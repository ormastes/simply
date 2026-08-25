<!-- llm-process-gen: managed source=gemini_release_skill source_sha256=cba19ebd846a836863e557a9733f55fa347693bd2522e01a872056442e849c0e content_sha256=3685dfc0685f8af14d0267be5baa0fad7fe81e6c9673629e95b556c1e4b3d522 -->
# release

Source: `.gemini/commands/release.toml`

Version bump and release. Args: major/first, minor/second, patch/third (default), or exact X.Y.Z.

Perform a version bump and release.

Parse argument:
- Empty or patch/third: bump patch (Z+1)
- minor/second: bump minor (Y+1, reset Z)
- major/first: bump major (X+1, reset Y and Z)
- X.Y.Z pattern: set exact version

Steps:
1. Read current version from simple.sdn (project.version)
2. Calculate new version
3. Update all locations:
   - simple.sdn (version: X.Y.Z)
   - VERSION file
   - src/app/cli/main.spl (hardcoded fallback in get_version())
   - src/app/cli/bootstrap_main.spl (hardcoded in bootstrap_version())
4. Update CHANGELOG.md with new section header
5. Commit
6. Tag: git tag -a vX.Y.Z
7. Ask before push — do NOT push without user approval

Prerequisite: /verify must show STATUS: PASS first. SPipe/manual evidence,
lower-model sidecar review, and workflow/tooling/evidence/spec/verification
contract docs must already be complete from verify. Release must not create or
update SPipe specs, repair generated-manual quality, accept sidecar-review gaps,
or repair stale doc/07_guide, doc/06_spec, .codex/skills, .agents/skills,
.claude/skills, .claude/agents/spipe, or .gemini/commands instructions. Before
proceeding, confirm `find doc/06_spec -name '*_spec.spl' | wc -l` returns `0`.
""

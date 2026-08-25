# Build Agent - Building and Releasing

**Use when:** Building the project, creating releases, managing packages.
**Skills:** `/release`

## Quick Build Commands

```bash
bin/simple build                    # Debug build
bin/simple build --release          # Release build
bin/simple build --bootstrap        # Bootstrap build (minimal)

bin/simple test                     # Run all tests
bin/simple build lint               # Run linter
bin/simple build fmt                # Format code
bin/simple build check              # All quality checks

bin/simple build clean              # Clean artifacts
bin/simple build bootstrap          # 3-stage bootstrap pipeline
bin/simple build watch              # Watch mode (auto-rebuild)
```

## Running Tests

```bash
bin/simple test                          # All tests
bin/simple test path/to/spec.spl         # Single file
bin/simple test --list                   # List tests
bin/simple test --only-slow              # Slow tests only
```

## Release Process

1. Update version in `simple.sdn`
2. Update `CHANGELOG.md`
3. Commit: `jj commit -m "chore: Release vX.Y.Z"`
4. Tag: `git tag -a vX.Y.Z -m "Release vX.Y.Z"` (use git for tags)
5. Push: `jj bookmark set main -r @- && jj git push --bookmark main && git push origin vX.Y.Z`
6. Monitor GitHub Actions
7. Verify: `gh release view vX.Y.Z`

## Version Types

| Type | Format | Stability |
|------|--------|-----------|
| Stable | `v1.2.3` | Production |
| RC | `v1.2.3-rc.1` | Pre-release |
| Beta | `v1.2.3-beta.1` | Feature testing |
| Alpha | `v1.2.3-alpha.1` | Early testing |

## Pre-Release Checklist

- [ ] All tests passing: `bin/simple test`
- [ ] No lint warnings: `bin/simple build lint`
- [ ] Version updated in `simple.sdn`
- [ ] CHANGELOG.md updated
- [ ] Local build verified

## Binary Architecture

| Binary | Location | Purpose |
|--------|----------|---------|
| `simple` | `bin/simple` | CLI entry point |
| `simple` | `bin/release/simple` | Release runtime (33MB) |

## See Also

- `/release` - Full release guide with rollback procedures

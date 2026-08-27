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

1. Start an isolated release work branch and worktree from the fetched target.
2. Update the canonical version authority and verify every projection.
3. Admit beta bug fixes only as reviewed, exact-provenance backports.
4. Integrate through the protected authority and freeze one immutable candidate.
5. Build and qualify once; required paths may not use fallback artifacts.
6. Promote exact admitted artifacts and create only the exact signed tag.
7. Withdraw or supersede failures without rewriting published identity.

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

# Claude Code File Exclusion Research

**Date:** 2026-03-13
**Status:** Official mechanism is `permissions.deny` in `.claude/settings.json`

## Official Mechanism: `permissions.deny`

`.claudeignore` is **not an official feature**. The documented way to exclude files from Claude Code is `permissions.deny` with `Read()` patterns in `.claude/settings.json`.

```json
{
  "permissions": {
    "deny": [
      "Read(/build/**)",
      "Read(/tmp/**)",
      "Read(./.env)"
    ]
  }
}
```

### What It Does

- **Excludes from search** — files won't appear in Glob/Grep results (best-effort)
- **Blocks reads** — Claude cannot read matching files
- **Deny always wins** — deny rules override allow rules at any level

### Pattern Syntax (gitignore spec)

| Pattern | Meaning |
|---------|---------|
| `/path` | Relative to **project root** |
| `./path` | Relative to **current directory** |
| `~/path` | Relative to **home directory** |
| `//path` | **Absolute** filesystem path |
| `*` | Matches files in a **single** directory |
| `**` | Matches **recursively** across directories |

Examples:
- `Read(/build/**)` — all files under `<project>/build/`
- `Read(**/target/**)` — any `target/` directory recursively
- `Read(*.log)` — all `.log` files in current directory
- `Read(/src/compiler_cpp/*.c)` — `.c` files directly in that dir

### Scope

| Level | File | Override? |
|-------|------|-----------|
| Managed | OS/MDM policy | Cannot be overridden |
| CLI args | `--disallowedTools` | Session only |
| Local | `.claude/settings.local.json` | Not committed |
| Project | `.claude/settings.json` | Shared with team |
| User | `~/.claude/settings.json` | Personal global |

## What About .claudeignore?

- **Not officially supported** — not in Claude Code docs
- **Widely discussed** — GitHub issues #579, #4160, #2305, #5105, #29455
- **Blog posts reference it** but they likely use the community [claude-ignore](https://github.com/li-zhixin/claude-ignore) PreToolUse hook
- **Old `ignorePatterns`** setting was deprecated → replaced by `permissions.deny`

## .gitignore Interaction

- `respectGitignore` setting (default: `true`) — `@` file picker respects `.gitignore`
- But `.gitignore` does **not** block Claude from reading files if asked directly
- `permissions.deny` is stricter — actually blocks access

## What to Exclude (from other projects)

### Tier 1: Must Exclude (biggest token savings)

These are the highest-impact exclusions. A single scan of these can waste hundreds of thousands of tokens.

| Category | Patterns | Impact |
|----------|----------|--------|
| **Dependencies** | `node_modules/`, `.venv/`, `vendor/` | Massive — can be GBs |
| **Rust/Cargo** | `**/target/**` | Often largest dir in project |
| **Build output** | `build/`, `dist/`, `out/`, `.next/` | .next/ alone saves 30-40% in Next.js |
| **Compiled binaries** | `bin/release/**`, `bootstrap/**` | Large binaries, no useful context |
| **Temp files** | `tmp/`, `*.tmp`, `*.temp`, `*.bak` | Noise |

### Tier 2: Should Exclude (noise reduction)

| Category | Patterns | Why |
|----------|----------|-----|
| **Object files** | `*.o`, `*.a`, `*.so`, `*.dylib`, `*.dll` | Binary, unreadable |
| **VCS internals** | `.git/**`, `.jj/**` | Use git CLI instead |
| **IDE config** | `.vscode/`, `.idea/` | Not code |
| **OS files** | `.DS_Store`, `Thumbs.db` | Noise |
| **Cache** | `__pycache__/`, `*.pyc`, `.cache/`, `.turbo/` | Generated |
| **Coverage** | `coverage/`, `htmlcov/`, `*.profraw`, `*.profdata` | Output |
| **Logs** | `*.log` | Noise |
| **Lock files** | `*.lock`, `package-lock.json` | Very large, rarely useful |
| **Minified code** | `*.min.js`, `*.min.css`, `*.map` | Unreadable |

### Tier 3: Project-Specific

| Category | Patterns | Why |
|----------|----------|-----|
| **Auto-generated reports** | `doc/report/` | Regenerated each test run |
| **Generated source** | `src/compiler_cpp/*.c` | Generated C from Simple source |
| **Lean verification** | `verification/**/.lake/` | Academic toolchain, not main code |
| **QEMU resources** | `resources/qemu/` | Downloaded binaries |
| **Media/binaries** | `*.png`, `*.jpg`, `*.mp4` | Not code context |
| **Packages** | `*.tar.gz`, `*.zip`, `*.deb` | Release artifacts |
| **Database files** | `*.db`, `*.sqlite` | Binary data |

### Do NOT Exclude

- **Source code** (`.spl`, `.shs`) — the actual implementation
- **Test files** — needed for understanding test coverage
- **Design/architecture docs** — critical for context
- **Config files** — project setup
- **CLAUDE.md / AGENTS.md** — Claude's own instructions
- **Runtime C source** (`src/runtime/`) — needed for understanding FFI

## Token Savings (from other projects)

| Technique | Savings |
|-----------|---------|
| Exclude build artifacts + deps | **30-40%** |
| + Prompt precision | **15-25%** |
| + /compact usage | **10-15%** |
| + CLAUDE.md trimming | **5-10%** |
| **Combined** | **40-55% total** |

Excluding `.next/` alone in a Next.js project saves 30-40%. Excluding `node_modules/` prevents reading 5,000+ line lock files. For this project, excluding `target/` (439 GB) and `build/` (14 GB) is the biggest win.

## This Project: Size Impact

| Directory | Size | Files |
|-----------|------|-------|
| `src/compiler_rust/target/` | ~439 GB | Rust build artifacts |
| `build/` | ~14 GB | CMake/Ninja output |
| `verification/**/.lake/` | ~4.8 GB | Lean 4 build artifacts |
| `.git/` | ~1.2 GB | VCS internals |
| `bin/release/*` | ~674 MB | Compiled binaries |
| `tmp/` | ~431 MB | Temporary test files |
| `bootstrap/` | ~134 MB | Multi-stage bootstrap binaries |
| `doc/report/` | ~25 MB | 2,296 auto-generated report files |

**Before:** ~460 GB in Claude's search space
**After:** ~80 MB of actual source code

## References

- [Claude Code Settings](https://code.claude.com/docs/en/settings) — official `permissions.deny` docs
- [Claude Code Permissions](https://code.claude.com/docs/en/permissions) — full rule syntax reference
- [7 Ways to Cut Token Usage](https://dev.to/boucle2026/7-ways-to-cut-your-claude-code-token-usage-elb)
- [50% Token Reduction](https://32blog.com/en/claude-code/claude-code-token-cost-reduction-50-percent)
- [Community claude-ignore hook](https://github.com/li-zhixin/claude-ignore)
- GitHub Issues: [#579](https://github.com/anthropics/claude-code/issues/579), [#4160](https://github.com/anthropics/claude-code/issues/4160), [#29455](https://github.com/anthropics/claude-code/issues/29455)

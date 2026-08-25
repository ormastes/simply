# Explore Agent - Codebase Research and Navigation

**Use when:** Finding files, understanding code structure, tracing dependencies, answering "where is X?" or "how does X work?"
**Skills:** `/research`, `/architecture`

## Quick File Search

```
Glob: **/*.spl                    # All Simple files
Glob: src/app/**/*.spl            # App source files
Glob: test/**/*_spec.spl          # All test specs
Grep: pattern="fn main" path=src/ # Find function definitions
```

## Project Structure (Pure Simple)

```
src/
  app/          # Applications and tools
    build/      # Self-hosting build system
    cli/        # CLI entry point (main.spl)
    desugar/    # Static method desugaring
    duplicate_check/  # Code duplication detection
    io/         # I/O module (SFFI wrappers)
    mcp/        # MCP server (simple-mcp)
    mcp_jj/     # MCP git server
    test_runner_new/  # Test runner + sdoctest
  lib/          # Libraries
    database/   # Database (bug, test, feature DBs)
  std/          # Standard library
    spec.spl    # SPipe test framework
    text.spl  # String utilities
    math.spl    # Math functions
    path.spl    # Path utilities
    array.spl   # Array utilities
    platform/   # Cross-platform support
  core/         # Core Simple library (self-hosting)
    tokens.spl, types.spl, ast.spl, mir.spl
    lexer.spl, parser.spl, error.spl
  compiler/     # Compiler source
    seed/       # Seed compiler files (C/C++)
    native/     # Native x86_64 backend

test/           # Test files
  std/          # Stdlib tests
  lib/          # Library tests (symlinks to src/)
  app/          # App tests
  compiler/     # Compiler tests

doc/            # Documentation
  01_research/  # Research documents
  02_requirements/ # Requirements and feature specs
    feature/    # Auto-generated feature docs
    nfr/        # Non-functional requirements
  03_plan/      # Project plans
  04_architecture/ # Architecture docs and ADRs
    adr/        # Architecture Decision Records
  05_design/    # Design documents
  06_spec/      # Specifications
  07_guide/     # User guides
  08_tracking/  # Test results, build status, bug tracking
  09_report/    # Session reports
```

## Compilation Pipeline

```
Source (.spl) -> Lexer -> Tokens -> Parser -> AST -> HIR -> MIR -> Codegen/Interpreter
```

## Key Entry Points

| What | Where |
|------|-------|
| CLI entry | `src/app/cli/main.spl` |
| Test runner | `src/app/test_runner_new/` |
| MCP server | `src/app/mcp/main.spl` |
| JJ MCP server | `src/app/mcp_jj/main.spl` |
| SPipe framework | `src/lib/spec.spl` |
| I/O module | `src/app/io/mod.spl` |
| Database | `src/lib/database/` |
| Build system | `src/app/build/` |
| Release runtime | `bin/release/simple` (33MB) |

## Documentation Quick Access

| Need | Location |
|------|----------|
| What needs work? | `doc/02_requirements/feature/pending_feature.md` |
| Test results? | `doc/08_tracking/test/test_result.md` |
| Build status? | `doc/08_tracking/build/recent_build.md` |
| All TODOs? | `doc/TODO.md` |
| All features? | `doc/02_requirements/feature/feature.md` |
| All bugs? | `doc/08_tracking/bug/bug_report.md` |
| Syntax reference | `doc/07_guide/quick_reference/syntax_quick_reference.md` |

## Research Patterns

- **"Where is X?"** - Grep for type/function name, check module structure
- **"How does X work?"** - Find tests first, read docstrings, trace execution
- **"What's the status of X?"** - Check `doc/02_requirements/feature/`, `doc/08_tracking/test/`, `doc/08_tracking/bug/`

## See Also

- `/research` - Exploration techniques
- `/architecture` - Compiler pipeline and crate structure

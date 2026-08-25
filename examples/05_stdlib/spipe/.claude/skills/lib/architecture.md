# Architecture Skill - Debugging & Feature Addition Procedures

Reference: See `ref_architecture` memory for pipeline diagrams, MIR instructions, backend details.

## Adding New Features — Checklist

1. **Lexer/Parser**: `src/compiler/10.frontend/core/lexer.spl`, `parser.spl`
2. **Source desugar**: `src/app/desugar/` (if new syntax sugar)
3. **Block parsers**: `src/compiler/15.blocks/` (if new DSL block)
4. **Type system**: `src/compiler/30.types/`
5. **HIR lowering**: `src/compiler/20.hir/`
6. **MIR lowering**: `src/compiler/50.mir/`
7. **Backend**: `src/compiler/70.backend/` (if new instruction)
8. **Standard library**: `src/lib/`
9. **Tests**: `test/`

## Debugging Pipeline Issues

```bash
# Check parse errors
bin/simple query check file.spl --format json

# Workspace diagnostics
bin/simple query workspace-diagnostics src/ --format json

# Find symbols
bin/simple query workspace-symbols --query MyType --kind class

# Trace definition
bin/simple query definition file.spl 42

# Find all references
bin/simple query references file.spl 42
```

## Lean Verification Workflow

```bash
simple gen-lean generate                    # All projects
simple gen-lean compare                     # Show status
simple gen-lean compare --diff              # Show differences
```

When modifying type inference:
1. Update `src/compiler/30.types/`
2. Update Lean theorems in `src/verification/type_inference_compile/`
3. Run `lake build` in verification project
4. Run `simple gen-lean compare`

## Design Checklist

Before: Read feature spec, identify affected pipeline stages, draw dependency impact.
After: `bin/simple test`, `simple gen-lean compare` if verification affected.

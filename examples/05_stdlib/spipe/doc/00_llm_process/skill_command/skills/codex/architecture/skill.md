<!-- llm-process-gen: managed source=codex_architecture_skill source_sha256=9cc8b2fa86d07e8aa0ae3e99d5132c12f5c1b7a879a33db37ad582989ea1e20b content_sha256=9cc8b2fa86d07e8aa0ae3e99d5132c12f5c1b7a879a33db37ad582989ea1e20b -->
---
name: architecture
description: "Codex architecture skill (Codex-specific strength). MDSOC patterns, virtual capsules, feature transforms, module structure evaluation, ADR writing. Reference: doc/04_architecture/."
---

# Architecture — Codex (Codex-Specific Strength)

**Cooperative Phase:** Design support (Step 4) and standalone architecture analysis
**Self-sufficient.** Can evaluate architecture independently at any time.

Codex excels at architecture evaluation, pattern selection, and MDSOC design. Use this skill for architecture-focused tasks.

## Tools

- **Simple MCP** — query codebase structure, module graph
- **Simple LSP MCP** — symbol lookup, dependency analysis
- **Context7 MCP** — external architecture references

## Capabilities

### 1. MDSOC Pattern Application

Multi-Dimensional Separation of Concerns patterns from `src/compiler/85.mdsoc/`:

- **Virtual Capsules** — encapsulate cross-cutting features as deployable units
- **Feature Transforms** — compile-time weaving of aspect-like concerns
- **Adapters** — runtime composition of modular behaviors
- **Weaving** — combine capsules into final compilation units

#### When to Apply MDSOC

| Signal | Pattern |
|--------|---------|
| Feature crosses 3+ module boundaries | Virtual capsule |
| Cross-cutting behavior (logging, auth, metrics) | Feature transform |
| Runtime-switchable behavior | Adapter |
| Multiple independent concerns in one file | Capsule decomposition |

#### MDSOC Rules for This Repo

- `common` owns contracts, shared formats, stable traits, and cross-layer tree nodes
- Compiler, loader, and interpreter may consume common nodes directly
- Sibling layers must not reach into each other's private implementation subtrees
- If two siblings need the same node, move it upward into a common ancestor or shared layer
- Frontend grammar stays single-source — no interpreter-only or loader-only grammar forks

### 2. Module Structure Evaluation

Analyze existing module structure for:
- **Cohesion** — does each module have a single responsibility?
- **Coupling** — are module dependencies minimal and well-defined?
- **Layering** — does the numbered layer convention (00-99) hold?
- **Size** — files > 800 lines need splitting
- **Duplication** — shared code should be extracted to common layers

#### Compiler Layer Map

```
00.common    → Error types, config, effects, visibility
10.frontend  → Lexer, parser, AST
15.blocks    → Block definitions
20.hir       → HIR types, lowering, inference
25.traits    → Trait system
30.types     → Type inference, constraints
35.semantics → Analysis, lint, resolve
40.mono      → Monomorphization
50.mir       → MIR types, lowering
55.borrow    → Borrow checking
60.mir_opt   → MIR optimization
70.backend   → Code generation (LLVM, C, Cranelift, WASM, CUDA, Vulkan)
80.driver    → Pipeline, build mode
85.mdsoc     → Virtual capsules, transforms
90.tools     → API surface, coverage
95.interp    → Interpreter
99.loader    → Module resolver
```

### 3. ADR (Architecture Decision Record) Writing

Write ADRs in `doc/04_architecture/` following this template:

```markdown
# ADR-NNN: <Title>

## Status
Proposed | Accepted | Deprecated | Superseded by ADR-XXX

## Context
<Why this decision is needed>

## Decision
<What we decided>

## Consequences
### Positive
- <benefit>

### Negative
- <tradeoff>

### Neutral
- <observation>

## References
- <related ADRs, docs, code paths>
```

### 4. Refactor Heuristic

**Good extraction targets:**
- Duplicated file-format structs
- Shared symbol/relocation metadata
- Common diagnostics and protocol contracts
- Loader/compiler/interpreter bridge traits

**Bad extraction targets:**
- Hot-path execution code with different invariants
- Backend-specific optimization logic
- Convenience helpers used by only one layer

## Artifacts Produced

| Artifact | Path |
|----------|------|
| Architecture docs | `doc/04_architecture/<feature>.md` |
| ADRs | `doc/04_architecture/adr/ADR-NNN.md` |
| Refactoring plans | `doc/03_plan/design/<feature>_refactor.md` |

## Multi-LLM Collaboration

- If other LLMs produced architecture docs, review and extend — never overwrite
- Codex is the preferred architecture evaluator in cooperative mode
- Tag Codex-produced artifacts with `<!-- codex-architecture -->` comment

## Rules

- All code in `.spl` — no Python, no Bash
- NO inheritance — use composition, alias forwarding, traits, or mixins
- Prefer tree-private by default; allow sibling access only through extracted common nodes
- Use exact repo paths in documentation, not assumptions
- Always inspect the real module tree before documenting

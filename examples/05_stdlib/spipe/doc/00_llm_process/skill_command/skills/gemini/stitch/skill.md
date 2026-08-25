<!-- llm-process-gen: managed source=gemini_stitch_skill source_sha256=9e92661b40ef1b8a76416531aef8d93f61b2170cc8cb88b2cd546b507c6e4dbd content_sha256=adba7d1b4413576c4b70206a12b9e788437d13eb204ab2c80a9f2b0f386cab5c -->
# stitch

Source: `.gemini/commands/stitch.toml`

Multi-file code generation and scaffolding using Stitch MCP. Creates module structures following Simple language rules.

Generate multi-file scaffolding for the given feature or module. Uses Stitch MCP for template-based generation.

Phase 1: Structure Planning
- Determine module placement in src/ tree (lib/, compiler/, app/)
- Plan file list with dependencies between files
- Identify imports needed (use std.X for stdlib, use lib.X equivalent)
- Map to existing patterns in the codebase

Phase 2: Template Generation (Stitch MCP)
- Generate all .spl files with proper module structure
- Include mod.spl for each new directory
- Follow Simple language rules strictly:
  - Generics: <T> not [T]
  - Constructors: ClassName(field: value) not .new()
  - Pattern binding: if val not if let
  - Error handling: Result<T, E> + ? operator
  - No inheritance: use composition, traits, mixins
  - val (immutable, preferred) or var (mutable)

Phase 3: Test Scaffolding
- Create spec files in test/ mirroring src/ structure
- Use SPipe BDD format: describe/context/it blocks
- Include built-in matchers only: to_equal, to_be, to_be_nil, to_contain,
  to_start_with, to_end_with, to_be_greater_than, to_be_less_than
- Do not use to_be_true()/to_be_false(); assert concrete values, or use
  to_be(true/false) only when the boolean itself is the behavior.

Phase 4: Documentation Scaffolding
- Create stub design doc: doc/05_design/<feature>.md
- Create stub architecture doc: doc/04_architecture/<feature>.md (if new subsystem)

All code in .spl files — no Python, no Bash.
No pass_todo in generated code. Temporary shared placeholders must fail
explicitly with assert(false) or fail(...).
Reference: doc/07_guide/quick_reference/syntax_quick_reference.md
"""

# Coding Skill - Workflow & Standards

Reference: See `ref_coding` memory for syntax rules, type names, lambda shorthands, EasyFix rules.

## Compile & Fix Workflow

```bash
bin/simple build                    # Debug build
bin/simple build --release          # Release build
bin/simple build lint               # Check warnings — fix all before committing
bin/simple fix file.spl --dry-run   # Preview auto-fixes
bin/simple fix file.spl             # Apply fixes
bin/simple lint file.spl --fix      # Lint with auto-fix
```

## Coding Standards

- Only make directly requested changes
- Don't add features beyond what's asked
- Don't refactor surrounding code or add docstrings to unchanged code
- Don't add error handling for impossible scenarios
- Delete unused code completely (no `_vars`, `// removed`)
- Prefer 3 similar lines over premature abstraction

## Test Documentation (CRITICAL)

Use docstring markdown in SPipe tests — NO `println()` for documentation:

```simple
describe "Feature":
    """# Feature — Tests NFA pattern matching."""

    it "matches single chars":
        """Given: Pattern("a"), When: matches("a"), Then: true"""
        expect(Pattern.new("a").matches("a")).to_equal(true)
```

## Scripts Policy

ALL scripts in Simple (.spl), NOT Python/Bash. Run: `bin/simple scripts/tool.spl args`

## See Also

- `doc/07_guide/language/coding_style.md` — Full style guide
- `doc/07_guide/quick_reference/syntax_quick_reference.md` — Syntax reference

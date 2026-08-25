# User-Defined Custom Blocks

Create your own `xxx{}` block syntax in Simple with just 3 lines of code!

## Quick Start

```simple
use compiler.blocks.{define_block, register_block}
use compiler.blocks.modes.{LexerMode}
use compiler.blocks.value.{BlockValue}

# 1. Define your block
val heredoc = define_block("heredoc", LexerMode.Raw, \text:
    Ok(BlockValue.Raw(text.trim()))
)

# 2. Register it
register_block(heredoc)

# 3. Use it!
val content = heredoc{
    Hello, World!
    Multi-line text preserved.
}
```

That's it! You've created a custom block type.

## Three-Tier API

Choose the complexity level that fits your needs:

### Tier 1: Minimal API (80% of use cases)

**3 lines of code:**
```simple
val myblock = define_block("myblock", LexerMode.Raw, \text:
    Ok(BlockValue.Raw(text))
)
register_block(myblock)
```

**Use cases:** Simple text blocks, heredocs, comments

### Tier 2: Builder API (15% of use cases)

**5-10 lines with features:**
```simple
val sql = BlockBuilder("sql")
    .raw_text()
    .simple_parser(\text: parse_sql(text))
    .simple_validator(\val: validate_sql(val))
    .description("SQL query block")
    .build()
register_block(sql)
```

**Use cases:** DSLs, data formats (JSON, SQL, YAML), configs

### Tier 3: Full Trait (5% of use cases)

**Complete control with 20+ methods:**
```simple
struct AdvancedBlock(BlockDefinition):
    fn kind() -> text: "advanced"
    fn parse_payload(payload, ctx): ...
    fn validate(value, ctx): ...
    fn lexer_mode() -> LexerMode: ...
    # ... all methods
```

**Use cases:** Complex parsers, IDE integration, custom semantics

## Examples

See `user_defined_block_demo.spl` for complete working examples:

1. **Heredoc** - Simple multi-line text
2. **Port** - Validated port numbers (1-65535)
3. **Color** - Hex color codes (#RRGGBB)
4. **Comment** - Ignored blocks
5. **Config** - Key=value configuration

## API Reference

### Core Functions

| Function | Purpose |
|----------|---------|
| `define_block(kind, mode, parser)` | Create a simple block |
| `validated_block(kind, mode, parser, validator)` | Block with validation |
| `define_const_block(kind, mode, parser, eval)` | Compile-time evaluated block |
| `register_block(block_def)` | Register globally |
| `BlockBuilder(kind)` | Start building a block |

### Lexer Modes

| Mode | Description | Example |
|------|-------------|---------|
| `LexerMode.Raw` | Capture as-is | heredoc, comments |
| `LexerMode.Math` | Math syntax (^, ') | formulas |
| `LexerMode.Normal` | Standard tokens | expressions |

### Block Values

| Type | Purpose |
|------|---------|
| `BlockValue.Raw(text)` | Raw text |
| `BlockValue.Custom(type, value)` | Custom typed value |
| `BlockValue.Expr(expr)` | Expression AST |
| `BlockValue.Json(value)` | JSON data |
| `BlockValue.Sql(query)` | SQL query |

## How It Works

```
User Code:           val x = myblock{ content }
                              ↓
Lexer:               Detects "myblock" keyword
                              ↓
TreeSitter:          Captures BlockOutline
                              ↓
BlockResolver:       Looks up in BlockRegistry
                              ↓
                     Calls your parser
                              ↓
Parser:              Gets BlockValue, builds AST
                              ↓
Compiled:            Your block is part of the program!
```

The compiler automatically integrates your custom blocks into the full compilation pipeline.

## Tips

1. **Start simple** - Use Tier 1 for most blocks
2. **Add validation** - Catch errors early with validators
3. **Test thoroughly** - Use the testing framework
4. **Document** - Add descriptions and examples
5. **Reuse** - Share blocks as libraries

## More Examples

Check out the `custom_blocks_examples.spl` for advanced patterns:
- Regular expressions
- GraphQL queries
- Tensor definitions
- Shell commands
- And more!

## Next Steps

- Read `doc/guide/custom_blocks_tutorial.md` for detailed tutorial
- See `doc/guide/custom_blocks_cookbook.md` for recipes
- Check `src/compiler/blocks/` for implementation details

Happy block creating! 🎉

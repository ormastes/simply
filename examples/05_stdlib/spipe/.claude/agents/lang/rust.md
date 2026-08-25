# Rust Language Agent

**Language:** Rust
**File extensions:** `.rs`
**LSP server:** `rust-analyzer` (configured as plugin)

---

## Build & Test Commands

```bash
# Standard build
cargo build                              # Debug build
cargo build --release                    # Release build
cargo test                               # Run all tests
cargo test test_name                     # Single test
cargo test -- --nocapture                # Tests with stdout

# Bootstrap seed (this project's Rust code)
cd src/compiler_rust
cargo build --profile bootstrap -p simple-driver
# Output: src/compiler_rust/target/bootstrap/simple

# Quality
cargo clippy -- -D warnings              # Lint (must be clean)
cargo fmt                                # Format
cargo fmt -- --check                     # Check formatting
cargo doc --no-deps                      # Generate docs
```

## LSP Setup

`rust-analyzer` is already configured as a plugin. It reads `Cargo.toml` and
`rust-toolchain.toml` automatically. No additional setup needed.

Key LSP features: type inference display, macro expansion, inlay hints,
go-to-definition across crate boundaries.

## Style Rules

- **Clippy clean:** all code must pass `cargo clippy -- -D warnings`
- **Formatted:** all code must pass `cargo fmt -- --check`
- **Error handling:** use `Result<T, E>` and `?` operator; avoid `.unwrap()` in production
- **Naming:** `snake_case` functions/variables, `PascalCase` types, `SCREAMING_SNAKE` constants
- **Ownership:** prefer borrowing over cloning; use `&str` over `String` in function params
- **Unsafe:** minimize and document all `unsafe` blocks with safety invariants
- **Dependencies:** add to `Cargo.toml`; prefer well-maintained crates
- **Tests:** place unit tests in `#[cfg(test)] mod tests` within the same file

## Project-Specific Notes

- The Rust code in `src/compiler_rust/` is the **bootstrap seed only**
- **NEVER copy the Rust bootstrap binary to `bin/release/simple`**
- The Rust seed builds the Simple compiler; production binary is self-hosted Simple

## When To Use This Agent

Dispatch this agent when the task involves:
- Writing or editing `.rs` files
- Bootstrap compiler work in `src/compiler_rust/`
- Cargo.toml dependency management
- Rust-based tooling or build infrastructure
- Performance-critical native code where Rust is chosen over C

# Language-Specific Coding Agents

These agents are dispatched by the SStack orchestrator based on the programming
language of the task. Each agent knows its language ecosystem, LSP server, build
tools, and coding conventions.

## Available Agents

| Agent | Language | File Extensions | LSP Server |
|-------|----------|----------------|------------|
| [simple](simple.md) | Simple | `.spl`, `.shs` | `simple-lsp-mcp` (MCP) |
| [c_cpp](c_cpp.md) | C / C++ | `.c`, `.h`, `.cpp`, `.hpp` | `clangd` |
| [rust](rust.md) | Rust | `.rs` | `rust-analyzer` |
| [python](python.md) | Python | `.py`, `.pyi` | `pylsp` / `pyright` |
| [typescript](typescript.md) | TypeScript/JS | `.ts`, `.tsx`, `.js`, `.jsx` | `typescript-language-server` |
| [go](go.md) | Go | `.go` | `gopls` |

## LSP Requirements

| LSP Server | Install Command | Notes |
|-----------|----------------|-------|
| `simple-lsp-mcp` | Pre-configured in `.mcp.json` | Native MCP bridge, no install needed |
| `clangd` | `apt install clangd` / bundled with LLVM | Needs `compile_commands.json` |
| `rust-analyzer` | `rustup component add rust-analyzer` | Configured as plugin |
| `pylsp` | `pip install python-lsp-server` | Or use `pyright` |
| `pyright` | `pip install pyright` | Faster, stricter alternative |
| `typescript-language-server` | `npm i -g typescript-language-server` | Wraps `tsserver` |
| `gopls` | `go install golang.org/x/tools/gopls@latest` | Official Go LSP |

## Dispatch Logic

The orchestrator selects an agent based on:
1. **File extension** of the target file(s)
2. **Explicit language** specified in the task
3. **Directory context** (e.g., `src/compiler_rust/` implies Rust)

For multi-language tasks, the orchestrator may dispatch multiple language agents
sequentially or delegate to a general-purpose code agent.

## Usage

From the SStack orchestrator or any parent agent:
```
Read .claude/agents/lang/simple.md and use its rules to implement <feature>
```

## Adding New Language Agents

1. Create `.claude/agents/lang/<language>.md` following the existing format
2. Include: LSP server, build/test commands, style rules, when-to-use section
3. Update this README with the new agent entry
4. Keep each agent file to ~40-60 lines for fast loading

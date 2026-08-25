# Simple LLM HUD

`examples/llm_hud/` is a Simple-only HUD example for local LLM sessions.

It reads local Claude, Codex, and Gemini artifacts and renders a compact HUD with:

- provider and model
- approximate active context usage when exposed by the provider
- cumulative token usage
- recent tool activity
- agent and todo counts when available
- `jj` first, `git` fallback repo state

Run it with:

```bash
bin/simple examples/llm_hud/main.spl --provider auto
bin/simple examples/llm_hud/main.spl --provider all --mode tui
bin/simple examples/llm_hud/main.spl --provider codex --watch
```

Current provider behavior:

- Claude: parses `~/.claude/projects/**/*.jsonl`
- Codex: parses the newest `~/.codex/sessions/**/*.jsonl`
- Gemini: reads `~/.gemini/projects.json` and reports local availability

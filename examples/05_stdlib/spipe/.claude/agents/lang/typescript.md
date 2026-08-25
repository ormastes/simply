# TypeScript/JavaScript Language Agent

**Language:** TypeScript, JavaScript
**File extensions:** `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.mjs`
**LSP server:** `typescript-language-server` (wraps `tsserver`)

---

## Build & Test Commands

```bash
# Run TypeScript
npx tsx script.ts                        # Direct execution
npx ts-node script.ts                    # Alternative runner

# Build
npx tsc                                  # Compile TypeScript
npx tsc --noEmit                         # Type-check only
npm run build                            # Project build script

# Testing
npm test                                 # Project test script
npx jest                                 # Jest runner
npx vitest                               # Vitest runner
npx vitest run                           # Vitest single run

# Quality
npx eslint .                             # Linter
npx prettier --check .                   # Format check
npx prettier --write .                   # Auto-format

# Package management
npm install                              # Install dependencies
npm install package-name                 # Add dependency
npm install -D package-name              # Add dev dependency
```

## LSP Setup

Install globally or per-project:
```bash
npm install -g typescript typescript-language-server
```

The LSP reads `tsconfig.json` for project configuration. Key settings:
`strict: true`, `noEmit` for type-check-only projects, `paths` for aliases.

## Style Rules

- **Strict mode:** enable `strict: true` in `tsconfig.json`
- **Type annotations:** explicit return types on exported functions
- **Naming:** `camelCase` variables/functions, `PascalCase` types/classes/components
- **Imports:** use ES module syntax (`import`/`export`), not CommonJS
- **Null handling:** prefer `undefined` over `null`; use optional chaining (`?.`) and nullish coalescing (`??`)
- **Async:** use `async`/`await` over raw Promises; handle errors with try/catch
- **React (TSX):** functional components with hooks; avoid class components
- **No `any`:** use `unknown` and narrow with type guards

## Project-Specific Notes

- TypeScript may appear in web dashboard code under `app/web_dashboard/`
- MCP registry npm wrapper uses JavaScript: `tools/mcp-registry/`
- Prefer Simple (`.spl`) for core project code

## When To Use This Agent

Dispatch this agent when the task involves:
- Writing or editing `.ts`, `.tsx`, `.js`, `.jsx` files
- Web dashboard frontend development
- Node.js tooling or scripts
- npm package configuration (`package.json`, `tsconfig.json`)
- MCP registry or npm wrapper development
- React/frontend component work

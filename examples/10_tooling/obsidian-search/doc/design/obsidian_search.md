# Design: Obsidian Vault Search MCP Server

**See also:** [Requirements](../requirement/obsidian_search.md) | [Research](../research/obsidian_search.md) | [Plan](../plan/obsidian_search.md) | [Limitations](../bug/obsidian_search_limitations.md) | [Completion Report](../report/obsidian_search_complete_2026-03-16.md)

## Architecture
```
Obsidian Vault (.md files)
    ↓
vault_scanner → note_parser → indexer (in-memory arrays)
    ↓                              ↓
search_engine ← query_parser    graph (backlinks, authority)
    ↓                              ↓
ranker (6-stage pipeline)
    ↓
MCP server → tools → handlers → JSON-RPC responses
```

> **Implementation note:** Originally designed for SQLite + FTS5, but the interpreter runtime
> cannot resolve `sqlite_ffi` from standalone projects (see [Limitations L-1](../bug/obsidian_search_limitations.md#l-1-sqlite-sffi-not-available-in-interpreter-runtime)).
> Storage uses module-level global arrays with manual counters instead. Search uses
> term-frequency text matching as a BM25 approximation.

## Module Breakdown

### Core Layer
- **vault_scanner**: Walks vault directory, filters .md files, excludes .obsidian/, .trash/
- **note_parser**: Extracts frontmatter, wikilinks, tags, tasks, heading chunks
- **indexer**: In-memory storage via module-level arrays, manual ID generation, concat-pattern mutations (see [L-1](../bug/obsidian_search_limitations.md), [L-2](../bug/obsidian_search_limitations.md), [L-3](../bug/obsidian_search_limitations.md))
- **search_engine**: Term-frequency text matching (BM25 unavailable, see [L-9](../bug/obsidian_search_limitations.md)), operator filtering
- **graph**: Link graph, backlinks, forward links, authority scoring, BFS traversal
- **ranker**: 6-stage ranking pipeline (BM25 → operators → graph → authority → recency → semantic)

### MCP Layer
- **server**: Stdio protocol, initialize/tools-list/tools-call dispatch
- **tools**: Tool schema definitions for all 11 tools
- **handlers**: Per-tool handler functions routing to core modules

### Utility Layer
- **json_helpers**: JSON construction without external library
- **query_parser**: Operator extraction from search queries

## Data Model
4 record types stored in module-level arrays: `NoteRecord`, `ChunkRecord`, `LinkRecord`, `TaskRecord`. Originally planned as 5 SQLite tables + 2 FTS5 virtual tables, but adapted to in-memory storage (see [L-1](../bug/obsidian_search_limitations.md)).

## Ranking Pipeline
1. Lexical retrieval (term-frequency text matching; FTS5 BM25 unavailable)
2. Operator filtering (tag:, path:, title:, etc.)
3. Graph reranking (backlink count boost)
4. Authority score (iterative backlink-weighted)
5. Recency boost (linear decay over 90 days)
6. Semantic rerank (deferred to future version)

## Error Handling
- Missing vault path: server starts but returns empty results
- Malformed frontmatter: skip fields, use heading as title fallback
- Runtime extern failures: `?? []` / `?? ""` null coalescing on all extern calls
- Empty string to `int()`: guarded with empty check (see [L-5](../bug/obsidian_search_limitations.md))

# Plan: Obsidian Vault Search MCP Server

**See also:** [Requirements](../requirement/obsidian_search.md) | [Research](../research/obsidian_search.md) | [Design](../design/obsidian_search.md) | [Limitations](../bug/obsidian_search_limitations.md)

## Delivery Phases

### Phase 1: Foundation (4 tools)
- search_vault, read_note, search_by_tag, find_backlinks
- Core: vault_scanner, note_parser, indexer, search_engine
- MCP: server, tools (4 schemas), handlers (4 handlers)

### Phase 2: Graph + Ranking (4 tools)
- find_forward_links, find_related, find_authoritative_docs, graph_walk
- Core: graph, ranker, query_parser enhancements
- MCP: tools (+4 schemas), handlers (+4 handlers)

### Phase 3: Specialized (3 tools)
- search_tasks, search_decisions, explain_search
- Core: task/decision search in search_engine, explain in ranker
- MCP: tools (+3 schemas), handlers (+3 handlers)

## Implementation Order
```
build.sdn → util/json_helpers → util/query_parser
                                      ↓
core/vault_scanner → core/note_parser → core/indexer
                                             ↓
                                core/search_engine → core/graph → core/ranker
                                             ↓
                                mcp/server → mcp/tools → mcp/handlers
                                             ↓
                                         src/main.spl
```

## Test Strategy
- Unit tests: 6 spec files for core modules + query_parser
- Integration tests: vault_index_spec (scan→index→search), mcp_tools_spec (JSON→dispatch→JSON)
- System tests: full BDD scenarios against fixture vault

## Risks
- FTS5 availability: runtime check + LIKE fallback
- Wikilink edge cases: start with [[target]] and [[target|alias]] only
- No YAML parser: line-by-line frontmatter (covers 90% of Obsidian usage)

# Feature Request: Obsidian Search MCP — Gap Analysis & Roadmap

**Date:** 2026-03-30
**Status:** Proposed
**Source:** Competitive analysis of 11 Obsidian MCP servers + Official Obsidian CLI

---

## Current State (v0.1.0)

**11 read-only tools** in 3 phases:
1. `search_vault` — hybrid BM25/graph ranked search with operators
2. `read_note` — full note content + metadata
3. `search_by_tag` — find notes by tag
4. `find_backlinks` — notes linking TO a note
5. `find_forward_links` — notes a note links TO
6. `find_related` — related via links + shared tags
7. `find_authoritative_docs` — PageRank-style authority ranking
8. `graph_walk` — BFS traversal with configurable hops
9. `search_tasks` — checkbox task search with status filter
10. `search_decisions` — ADR/decision content search
11. `explain_search` — score breakdown per result

**Our unique strengths:** 6-stage ranking pipeline, authority ranking, decision search, graph walk, explain_search, all-read-only safety annotations.

---

## Competitors Analyzed

| # | Project | Stars | Tools | Connection | Lang |
|---|---------|-------|-------|------------|------|
| 1 | MarkusPfundstein/mcp-obsidian | 3.2k | 7 | Local REST API | Python |
| 2 | bitbonsai/mcpvault | 980 | 6+ | Direct filesystem | TS |
| 3 | jacksteamdev/obsidian-mcp-tools | 693 | 5+ | Obsidian plugin | TS |
| 4 | StevenStavrakis/obsidian-mcp | 670 | 10 | Direct filesystem | TS |
| 5 | cyanheads/obsidian-mcp-server | 422 | 8+ | Local REST API | TS |
| 6 | ToKiDoO/mcp-obsidian-advanced | 13 | 18+ | REST API + obsidiantools | Python |
| 7 | marcelmarais/obsidian-mcp-server | 26 | 4 | Direct filesystem | TS |
| 8 | MCPBundles Obsidian | commercial | 35 | Direct filesystem | TS |
| 9 | flowing-abyss/obsidian-hybrid-search | — | 5+ | Direct + SQLite | TS |
| 10 | smart-connections-mcp | — | 3+ | Embeddings plugin | TS |
| 11 | Official Obsidian CLI (v1.12.4) | — | 100+ | Obsidian app control | — |

---

## Feature Requests — Priority Ranked

### P0: Write Operations (most-requested across all competitors)

**FR-01: create_note**
- Create a new note with content and optional frontmatter
- Who has it: Steven, MCPVault, cyanheads, MCPBundles
- Annotations: `readOnlyHint: false, destructiveHint: false`

**FR-02: edit_note**
- Append, prepend, or overwrite note content
- Who has it: Markus (patch_content, append_content), cyanheads (update_note), Steven (edit_note)
- Modes: `append | prepend | overwrite | insert_after_heading`

**FR-03: delete_note**
- Delete a note file from the vault
- Who has it: Markus, Steven, ToKiDoO
- Annotations: `destructiveHint: true`

**FR-04: move_note**
- Move/rename a note, updating all wikilinks that reference it
- Who has it: Steven, Official CLI
- Critical: must update `[[links]]` across vault

### P1: Frontmatter & Tag Management

**FR-05: manage_frontmatter**
- Read/write/update YAML frontmatter properties
- Who has it: cyanheads, MCPBundles, Official CLI
- Operations: `get | set | delete` on frontmatter fields

**FR-06: add_tags / remove_tags / rename_tag**
- Mutate tags across the vault (inline `#tag` and frontmatter `tags:`)
- Who has it: Steven (add_tags, remove_tags, rename_tag)
- rename_tag: find-and-replace across all notes

### P2: Enhanced Search

**FR-07: fuzzy_search**
- Trigram-based typo-tolerant search on titles/aliases
- Who has it: Hybrid Search
- Complement to exact BM25 matching

**FR-08: search_replace**
- Regex-based search-and-replace within a note or across vault
- Who has it: cyanheads (obsidian_search_replace)
- Safety: dry-run mode, match preview before apply

**FR-09: date_range_search**
- Filter search results by modification/creation date range
- Who has it: MCPBundles
- Operators: `modified:2026-01-01..2026-03-30`, `created:last7d`

**FR-10: alias_indexing**
- Index note aliases (from frontmatter `aliases:`) and boost in search
- Who has it: Hybrid Search (title 10x, aliases 5x, content 1x)

### P3: Vault Analytics

**FR-11: vault_structure**
- Return vault tree structure (folder hierarchy, file counts, sizes)
- Who has it: ToKiDoO (understand_vault)
- Useful for orientation in large vaults

**FR-12: find_orphan_notes**
- Find notes with zero incoming links (unlinked/orphan)
- Who has it: MCPBundles
- Complement to our graph_walk and authority tools

**FR-13: vault_stats**
- Total notes, links, tags, tasks, words, avg links/note
- Who has it: ToKiDoO (understand_vault via NetworkX)

### P4: Periodic Notes & Templates

**FR-14: daily_note**
- Create/read today's daily note (or any date)
- Who has it: cyanheads, ToKiDoO, Official CLI
- Auto-detect daily note folder from vault config

**FR-15: periodic_notes**
- Access weekly/monthly/quarterly/yearly notes
- Who has it: cyanheads (obsidian_periodic_note)

**FR-16: apply_template**
- Apply a template to a new or existing note
- Who has it: jacksteamdev (Templater integration), Official CLI

### P5: Batch & Performance

**FR-17: batch_read_notes**
- Read multiple notes in a single call
- Who has it: ToKiDoO (batch_get_files), marcelmarais (readMultipleFiles)
- Reduces MCP round-trips for multi-note analysis

**FR-18: list_files**
- List files/directories in vault or subdirectory with metadata
- Who has it: Markus, MCPVault, Steven, ToKiDoO, MCPBundles

**FR-19: reindex_vault**
- Force re-scan and reindex the vault (currently implicit on first search)
- Who has it: implicit in most servers
- Make explicit with progress reporting

### P6: Advanced (Future)

**FR-20: semantic_search** (embedding-based)
- Vector similarity search using note embeddings
- Who has it: jacksteamdev, Hybrid Search, Smart Connections, Vectorize
- Requires: embedding model (local or API), vector store
- L-1 limitation: no SQLite FFI in interpreter — would need compiled mode

**FR-21: file_watch**
- Real-time incremental re-indexing via filesystem events
- Who has it: Hybrid Search (chokidar)
- Currently: must restart server to pick up changes

**FR-22: canvas_support**
- Read/write Obsidian canvas (.canvas JSON) files
- Who has it: none of the competitors (gap across ecosystem)
- Opportunity: first mover advantage

---

## Implementation Phases

### Phase A: Write Foundation (FR-01 to FR-04)
- 4 new tools, estimated ~400 lines
- Requires: file write FFI, wikilink updater for move_note
- New annotation profile: `readOnlyHint: false`

### Phase B: Metadata Management (FR-05, FR-06, FR-17, FR-18)
- 4 new tools + 2 tag tools
- Requires: YAML frontmatter parser (already have note_parser)
- Extend note_parser to round-trip frontmatter

### Phase C: Enhanced Search (FR-07 to FR-10, FR-19)
- 5 new/upgraded tools
- Extend search_engine with fuzzy, date range, alias boosting
- Add search-replace with dry-run safety

### Phase D: Analytics (FR-11 to FR-13)
- 3 new tools
- Build on existing graph infrastructure
- vault_structure is low-hanging fruit

### Phase E: Periodic Notes (FR-14 to FR-16)
- 3 new tools
- Need to parse vault `.obsidian/daily-notes.json` config
- Template support requires file read + variable substitution

### Phase F: Advanced (FR-20 to FR-22)
- Semantic search, file watching, canvas
- Depends on compiled mode for SQLite FFI
- Canvas is a unique opportunity

---

## Tool Count Projection

| Phase | Current | After |
|-------|---------|-------|
| Current | 11 | 11 |
| +Phase A | 11 | 15 |
| +Phase B | 15 | 21 |
| +Phase C | 21 | 26 |
| +Phase D | 26 | 29 |
| +Phase E | 29 | 32 |
| +Phase F | 32 | 35 |

Target: **35 tools** — matching MCPBundles (commercial) with open-source Simple implementation.

---

## References

- [MarkusPfundstein/mcp-obsidian](https://github.com/MarkusPfundstein/mcp-obsidian)
- [bitbonsai/mcpvault](https://github.com/bitbonsai/mcpvault)
- [jacksteamdev/obsidian-mcp-tools](https://github.com/jacksteamdev/obsidian-mcp-tools)
- [StevenStavrakis/obsidian-mcp](https://github.com/StevenStavrakis/obsidian-mcp)
- [cyanheads/obsidian-mcp-server](https://github.com/cyanheads/obsidian-mcp-server)
- [ToKiDoO/mcp-obsidian-advanced](https://github.com/ToKiDoO/mcp-obsidian-advanced)
- [flowing-abyss/obsidian-hybrid-search](https://forum.obsidian.md/t/hybrid-search-hybrid-search-mcp-server-cli-for-ai-assistants-bm25-semantic-obsidian-native/112491)
- [Obsidian Official CLI](https://help.obsidian.md/cli)
- [Obsidian Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api)

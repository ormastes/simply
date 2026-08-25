# Requirements: Obsidian Vault Search MCP Server

**See also:** [Research](../research/obsidian_search.md) | [Plan](../plan/obsidian_search.md) | [Design](../design/obsidian_search.md) | [Limitations](../bug/obsidian_search_limitations.md) | [Completion Report](../report/obsidian_search_complete_2026-03-16.md)

## Problem
Obsidian vaults lack agent-facing search tooling. The existing LSP handles editor UX (symbols, references, hover), but AI agents need richer search: ranked results, graph traversal, authority scoring, and structured tool semantics.

## Goal
Build a standalone Obsidian Search MCP server written in Simple, using hybrid BM25/FTS5 + graph-authority + metadata ranking over Obsidian vaults.

## Functional Requirements

### FR-1: Full-Text Search
- Search vault content using BM25 ranking via SQLite FTS5
- Support query operators: `tag:`, `path:`, `title:`, `alias:`, `heading:`, `linkto:`, `linkedfrom:`, `type:`, `modified:recent`
- Return ranked results with path, title, snippet, score

### FR-2: Note Reading
- Read full note content and metadata by path
- Return frontmatter (title, tags, aliases) alongside content

### FR-3: Tag-Based Discovery
- Find all notes matching a specific tag
- Support both frontmatter tags and inline `#tag` patterns

### FR-4: Link Graph
- Find backlinks (notes linking TO a given note)
- Find forward links (notes a given note links TO)
- Find related notes via backlinks + forward links + shared tags

### FR-5: Authority Scoring
- Compute authority based on inbound link count and weighted propagation
- Surface highly-linked "hub" notes for a given query

### FR-6: Graph Traversal
- BFS walk from a seed note with configurable hop limit
- Return visited nodes with depth

### FR-7: Task Discovery
- Search for tasks (checkboxes) across the vault
- Filter by status (open/done)

### FR-8: Decision Lookup
- Find decision-related content (ADRs, decision headings)

### FR-9: Score Explanation
- Return per-result score breakdowns showing BM25, graph, authority, recency contributions

## Non-Functional Requirements

### NFR-1: MCP Protocol
- Stdio-based MCP protocol (Content-Length framing + JSON Lines auto-detection)
- 11 tools across 3 delivery phases

### NFR-2: Incremental Indexing
- Track file mtime to avoid re-indexing unchanged files
- Support full re-index on startup

### NFR-3: Performance
- Handle vaults up to 10k+ notes via incremental indexing
- Process one file at a time to limit memory

### NFR-4: Written in Simple
- All code in .spl files
- Requires Simple compiler to build and run

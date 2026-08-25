# Research: Obsidian Vault Search

**See also:** [Requirements](../requirement/obsidian_search.md) | [Plan](../plan/obsidian_search.md) | [Design](../design/obsidian_search.md) | [Limitations](../bug/obsidian_search_limitations.md)

## Obsidian File Format
- Notes are Markdown files (.md) in a directory tree
- Frontmatter: YAML between `---` fences (title, tags, aliases)
- Wikilinks: `[[target]]` or `[[target|display text]]`
- Tags: `#tag` inline or in frontmatter `tags: [a, b]`
- Tasks: `- [ ]` (open) and `- [x]` (done)
- Block references: `^block-id` (not supported in v0.1)
- Embeds: `![[note]]` (not supported in v0.1)

## Existing Libraries
- SQLite FTS5: Full-text search with BM25 ranking — available via Simple's sqlite_ffi
- Markdown parser: `std.common.markdown` — heading/link extraction (standard MD, not Obsidian extensions)
- File I/O: `std.nogc_sync_mut.ffi.io` — recursive dir listing, file reading

## Search Approaches
- **BM25 via FTS5**: Best for lexical search, built into SQLite, no external deps
- **LIKE fallback**: For when FTS5 is not compiled into SQLite
- **Graph authority**: PageRank-inspired but simplified — count inbound links, propagate 1 round

## Obsidian-Specific Parsing Needs
- Wikilink extraction: `[[target|alias]]` — NOT standard markdown links
- Tag extraction: `#tag` inline — NOT headings
- Frontmatter: Simple `key: value` parser, no nested YAML needed
- Task extraction: `- [ ]` / `- [x]` patterns

## Known Limitations
- Simple's `.len()` corruption bug for module-level arrays — use local scope
- Chained method bug — use intermediate variables
- `substring()` is destructive — use safe_substr char iteration
- No YAML parser — simple line-by-line frontmatter parsing covers 90% of Obsidian

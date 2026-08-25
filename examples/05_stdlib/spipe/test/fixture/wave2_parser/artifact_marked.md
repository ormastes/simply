---
spipe:
  artifact:
    uid: A-00000000000000000000000000000001
    key: design.search.core
    aliases: [design.db.bm25, bm25-core]
    kind: design
    project_uid: P-000000000000000000000000000000AA
    features: [search, project_knowledge]
    components: [std.common.search]
    layers: [ranking]
---

# Shared BM25 Search Core

## Incremental Index Maintenance
<!-- spipe:section uid=S-00000000000000000000000000000001 key=design.search.incremental-maintenance -->
The index applies immutable deltas.

## Query Ranking
This section intentionally has no marker during observe-only migration.

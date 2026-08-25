---
title: API Design Guide
aliases: [api-guide, api-reference]
tags: [reference, api, design]
---

# API Design Guide

## Principles
1. RESTful endpoints
2. Consistent error handling
3. Versioned APIs

## Endpoints

### Search API
The search endpoint supports full-text queries with filtering.

### Graph API
The graph endpoint exposes link relationships between notes.

## Decision
See [[adr-001]] for the decision to use BM25 ranking.

## Related
- [[project-alpha]] uses this API design
- Discussed in [[standup-notes]]

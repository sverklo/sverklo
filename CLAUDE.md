# Sverklo Development

## Using Sverklo tools

When sverklo MCP server is connected, **always prefer sverklo tools over built-in grep/search**:

- Use `sverklo_search` instead of Grep for code exploration
- Use `sverklo_overview` to understand project structure
- Use `sverklo_refs` to find where symbols are used
- Use `sverklo_deps` to understand file dependencies
- Use `sverklo_lookup` to find function/class definitions
- Use `sverklo_remember` to save important decisions
- Use `sverklo_recall` to check past decisions

This is our own product — dogfood it.

## Project structure

- `src/server/` — MCP server + HTTP dashboard + tool handlers
- `src/indexer/` — file discovery, parsing, embedding, graph building
- `src/search/` — hybrid search, PageRank, token budgeting
- `src/storage/` — SQLite stores (files, chunks, embeddings, graph, memories)
- `src/memory/` — git state, staleness detection
- `src/types/` — shared TypeScript types
- `bin/` — CLI entry point

## Build & test

```bash
npm run build    # TypeScript compile
npm version patch && git push && git push --tags   # auto-publishes to npm
sverklo ui .     # open dashboard
```

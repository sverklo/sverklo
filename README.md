# codesearch-mcp

Local-first code search MCP server. Gives AI coding agents deep codebase understanding through hybrid text + semantic search, structural analysis, and dependency-aware ranking.

Works with Claude Code, Cursor, and any MCP-compatible client.

## Why

AI coding agents waste tokens reading irrelevant files. Claude Code has no built-in codebase indexing. Existing solutions are either cloud-dependent (Augment, Greptile) or incomplete (CocoIndex lacks graph ranking, Aider lacks MCP support).

codesearch-mcp fills the "local-first + full-featured" gap:
- **Tree-sitter-style AST parsing** — extracts functions, classes, types, interfaces from 10 languages
- **PageRank dependency ranking** — structurally important files surface first (inspired by Aider)
- **Real semantic embeddings** — all-MiniLM-L6-v2 via ONNX, runs locally, no API keys
- **Hybrid search** — BM25 text + vector similarity + Reciprocal Rank Fusion
- **Token-budgeted responses** — returns exactly what fits in your context window
- **Incremental indexing** — watches for file changes, updates in real-time
- **Zero config** — auto-detects project, auto-indexes, respects .gitignore

## Quick Start

```bash
# 1. Clone and build
git clone https://github.com/your-org/codesearch-mcp
cd codesearch-mcp
npm install && npm run build

# 2. Download the embedding model (~90MB, one-time)
node dist/bin/codesearch-mcp.js setup

# 3. Add to Claude Code
claude mcp add codesearch-mcp -- node /path/to/codesearch-mcp/dist/bin/codesearch-mcp.js .
```

## MCP Tools

### `search`
Hybrid text + semantic code search with PageRank boosting.

```
query: "authentication middleware that validates JWT tokens"
token_budget: 4000    # max tokens to return
scope: "src/api/"     # limit to path prefix
language: "typescript" # filter by language
type: "function"      # filter by symbol type
```

### `overview`
Structural codebase map. Shows most important files and their symbols, ranked by dependency graph importance.

```
path: "src/"          # directory to overview
token_budget: 4000
```

### `lookup`
Direct symbol lookup by name. Returns full definitions.

```
symbol: "createRouter"
type: "function"      # function, class, type, interface, method, variable
```

### `find_references`
Find all references to a symbol across the codebase.

```
symbol: "UserService"
token_budget: 3000
```

### `dependencies`
Show a file's import graph — what it depends on and what depends on it.

```
path: "src/api/router.ts"
direction: "both"     # imports, importers, or both
depth: 2              # traversal depth
```

### `index_status`
Check index health — file count, chunk count, languages, indexing progress.

## Supported Languages

TypeScript, JavaScript, Python, Go, Rust, Java, C, C++, Ruby, PHP

## How It Works

1. **File discovery** — walks the project, respects .gitignore and .codesearchignore
2. **AST parsing** — regex-based structural extraction (functions, classes, types, imports)
3. **NL descriptions** — generates natural language descriptions from AST metadata (Greptile's key insight: embed descriptions, not raw code)
4. **Embeddings** — all-MiniLM-L6-v2 ONNX model generates 384d vectors locally
5. **Dependency graph** — resolves imports, builds file-level graph, computes PageRank
6. **Hybrid search** — combines BM25 text search + cosine similarity + PageRank boosting via Reciprocal Rank Fusion
7. **Token budgeting** — packs results to fit within the specified token budget

## Performance

On its own codebase (30 files, 71 chunks):
- Indexing: **681ms** (including ONNX embedding)
- Search: **<50ms** per query
- Memory: **~200MB** (ONNX runtime + cached embeddings)

## Configuration

- **Model files**: `~/.codesearch/models/model.onnx` and `tokenizer.json`
- **Index database**: `~/.codesearch/<project-hash>/index.db`
- **Custom ignores**: add a `.codesearchignore` file to your project root
- **Debug logging**: set `CODESEARCH_DEBUG=1`

## Architecture

```
MCP Client (Claude Code / Cursor)
    │ stdio
    ▼
MCP Server (6 tools)
    │
    ├─ Retrieval Engine
    │   ├─ BM25/FTS5 (text search)
    │   ├─ Vector cosine similarity (semantic)
    │   ├─ PageRank boost (structural importance)
    │   └─ RRF fusion → Token budget packer
    │
    └─ Indexing Pipeline
        ├─ File discovery (gitignore-aware)
        ├─ AST parsing (10 languages)
        ├─ NL description generation
        ├─ ONNX embedding (MiniLM, 384d)
        ├─ Dependency graph + PageRank
        └─ Chokidar file watcher (incremental)

Storage: SQLite (FTS5 + vector BLOBs + graph edges)
```

## Free vs Pro

The core code search MCP is **free and open source** (MIT). Use it forever, no limits.

**codesearch-mcp Pro** (coming soon) adds:
- Session memory — decisions, preferences, patterns that persist across sessions
- Memory quality scoring — confidence levels, staleness detection, contradiction resolution
- Git-state linked memories — know what the code looked like when a decision was made
- Cross-project pattern transfer — your coding style follows you
- Larger embedding models for better search quality

**codesearch-mcp Team** (coming soon) adds:
- Shared team memory — architectural decisions, coding conventions
- Cross-developer AI coordination
- On-prem deployment
- Admin dashboard

## Roadmap

- [ ] Tree-sitter WASM for more accurate AST parsing
- [ ] Cross-repository search
- [ ] npm publish (`npx codesearch-mcp`)
- [ ] Pro: Session memory with quality scoring
- [ ] Pro: Git-state linked memories
- [ ] Team: Shared team knowledge layer
- [ ] Team: On-prem deployment

## License

MIT — free for personal and commercial use.

# Sverklo

Code intelligence for AI agents. Local-first, zero config, semantic search.

Sverklo gives AI coding agents (Claude Code, Cursor, any MCP client) deep codebase understanding through hybrid text + semantic search, structural analysis, and dependency-aware ranking.

## Why

AI coding agents waste tokens reading irrelevant files. Claude Code has no built-in codebase indexing. Existing solutions are either cloud-dependent (Augment, Greptile) or incomplete (CocoIndex lacks graph ranking, Aider lacks MCP).

Sverklo fills the gap:
- **AST-aware parsing** — extracts functions, classes, types, interfaces from 10 languages
- **PageRank ranking** — structurally important files surface first
- **Semantic embeddings** — all-MiniLM-L6-v2 via ONNX, runs locally, no API keys
- **Hybrid search** — BM25 text + vector similarity + Reciprocal Rank Fusion
- **Token-budgeted** — returns exactly what fits in your context window
- **Incremental** — watches for file changes, updates in real-time
- **Zero config** — auto-detects project, auto-indexes, respects .gitignore

## Quick Start

```bash
# 1. Install
git clone https://github.com/nicenemo/sverklo
cd sverklo
npm install && npm run build

# 2. Download the embedding model (~90MB, one-time)
npx sverklo setup

# 3. Add to Claude Code
claude mcp add sverklo -- node /path/to/sverklo/dist/bin/sverklo.js .
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
Structural codebase map. Shows most important files and their symbols, ranked by PageRank.

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

1. **File discovery** — walks the project, respects .gitignore and .sverkloignore
2. **AST parsing** — structural extraction of functions, classes, types, imports
3. **NL descriptions** — generates natural language descriptions from code metadata (embed descriptions, not raw code)
4. **Embeddings** — all-MiniLM-L6-v2 ONNX model, 384d vectors, fully local
5. **Dependency graph** — resolves imports, builds file-level graph, computes PageRank
6. **Hybrid search** — BM25 + cosine similarity + PageRank via Reciprocal Rank Fusion
7. **Token budgeting** — packs results to fit within the specified budget

## Performance

On a 30-file TypeScript codebase (71 code chunks):
- Indexing: **681ms** (including ONNX embedding generation)
- Search: **<50ms** per query
- Memory: **~200MB** (ONNX runtime + cached vectors)

## Configuration

| Setting | Location |
|---------|----------|
| Model files | `~/.sverklo/models/model.onnx` and `tokenizer.json` |
| Index database | `~/.sverklo/<project-hash>/index.db` |
| Custom ignores | `.sverkloignore` in project root |
| Debug logging | `SVERKLO_DEBUG=1` |

## Free vs Pro

The core is **free and open source** (MIT). Use it forever, no limits.

**Sverklo Pro** (coming soon):
- Session memory — decisions, preferences, patterns across sessions
- Memory quality scoring — confidence levels, staleness detection
- Git-state linked memories — what the code looked like when a decision was made
- Cross-project pattern transfer
- Better embedding models

**Sverklo Team** (coming soon):
- Shared team memory — architectural decisions, conventions
- Cross-developer AI coordination
- On-prem deployment
- Admin dashboard

## License

MIT

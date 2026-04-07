# Sverklo

**Other tools remember your conversations. Sverklo understands your code.**

Local-first code intelligence MCP with hybrid semantic search, symbol-level impact analysis, and bi-temporal memory tied to git state. **5.1× fewer tokens** than grep in benchmarks — roughly **$78–$390/month saved per developer** at Claude API pricing.

One command gives Claude Code, Cursor, or any MCP agent deep codebase understanding — semantic search, dependency ranking, and persistent memory. Everything runs locally. No API keys. No cloud.

```bash
npm install -g sverklo
cd your-project && sverklo init
```

That's it. `sverklo init` sets up everything — MCP server config, CLAUDE.md instructions, and hooks that ensure Claude uses sverklo tools over built-in grep.

---

## Before & After

**Without Sverklo** — agent greps for "auth", reads 15 files, burns 50K tokens, misses the relevant one:
```
> How does auth work?
Searched for 3 patterns...
This project doesn't have any auth middleware.   # Wrong
```

**With Sverklo** — semantic search finds the right code in <50ms:
```
> How does auth work?
Called sverklo_search with query "authentication"
Found validateToken() in src/middleware/auth.ts   # Correct
```

---

## What It Does

| Tool | What |
|------|------|
| `sverklo_search` | Hybrid semantic + text search across entire codebase |
| `sverklo_overview` | Structural codebase map ranked by PageRank importance |
| `sverklo_lookup` | Find any function, class, or type by name |
| `sverklo_refs` | Find all references to a symbol |
| `sverklo_deps` | Show file dependency graph (imports + importers) |
| `sverklo_status` | Index health check |
| `sverklo_remember` | Save decisions, preferences, patterns with git state |
| `sverklo_recall` | Semantic search over saved memories |
| `sverklo_forget` | Delete a memory |
| `sverklo_memories` | List all memories with health metrics |

## How It Works

```
Your code → Parse (10 languages) → Embed (ONNX, local)
                                  → Build dependency graph
                                  → Compute PageRank
                                        ↓
Agent query → BM25 text search ──┐
            → Vector similarity ──┼→ RRF fusion → Token-budgeted response
            → PageRank boost ────┘
```

1. **Parses** your codebase into functions, classes, types (TS, JS, Python, Go, Rust, Java, C, C++, Ruby, PHP)
2. **Embeds** code using all-MiniLM-L6-v2 ONNX model (384d vectors, fully local)
3. **Builds** a dependency graph and computes PageRank (structurally important files rank higher)
4. **Searches** using hybrid BM25 + vector similarity + PageRank, fused via Reciprocal Rank Fusion
5. **Remembers** decisions and patterns across sessions, linked to git state
6. **Watches** for file changes and updates incrementally

## Quick Start

```bash
npm install -g sverklo
cd your-project
sverklo init
```

This creates `.mcp.json` at your project root (the only file Claude Code reads for project-scoped MCP servers) and appends sverklo instructions to your `CLAUDE.md`. Safe to re-run.

If sverklo doesn't appear in Claude Code's `/mcp` list after restart, run:
```bash
sverklo doctor
```
This diagnoses MCP setup issues — checks the binary, the model, the config file location, the handshake, and tells you exactly what's wrong.

### Cursor / Windsurf / VS Code
These IDEs use their own MCP config locations. Use the **full binary path** to avoid PATH resolution issues in spawned subprocesses:
```json
{
  "mcpServers": {
    "sverklo": {
      "command": "/full/path/to/sverklo",
      "args": ["."]
    }
  }
}
```
Find the path with `which sverklo`. Add to:
- **Cursor:** `.cursor/mcp.json`
- **Windsurf:** `~/.windsurf/mcp.json`
- **VS Code:** `.vscode/mcp.json`
- **JetBrains:** Settings → Tools → MCP Servers

### Any MCP Client
```bash
npx sverklo /path/to/your/project
```

### Dashboard
```bash
npx sverklo ui .
```
Opens a web dashboard at `localhost:3847` — browse indexed files, search playground, memory viewer, dependency graph.

> **First run:** The ONNX embedding model (~90MB) downloads automatically. Takes ~30 seconds on first launch, then instant.

## Performance

| Metric | Value |
|--------|-------|
| Index 38 files | 640ms |
| Search query | <50ms |
| Memory footprint | ~200MB |
| Languages | 10 |
| Dependencies | zero config |

## Why Not...

| Alternative | Gap |
|-------------|-----|
| **Built-in grep** | No semantic understanding. Burns tokens reading irrelevant files. |
| **Augment** | Cloud-only, closed source, $20-200/mo |
| **Greptile** | Cloud-only, $30/dev/mo, no memory |
| **CocoIndex** | No PageRank ranking, no hybrid search, no memory |
| **Aider repo-map** | No MCP, no semantic search, no memory |
| **claude-mem** | Memory only, no code search, ChromaDB overhead |

Sverklo is the only tool that combines **code search + memory + dependency graph** in one local-first MCP server.

## Configuration

| Setting | Location |
|---------|----------|
| Model files | `~/.sverklo/models/` (auto-downloaded) |
| Index database | `~/.sverklo/<project>/index.db` |
| Custom ignores | `.sverkloignore` in project root |
| Debug logging | `SVERKLO_DEBUG=1` |

## Open Source, Open Core

The full MCP server is **free and open source** (MIT). All 10 tools, no limits.

**Sverklo Pro** (coming soon) adds smart auto-capture, cross-project patterns, and better models.

**Sverklo Team** (coming soon) adds shared team memory and on-prem deployment.

## Links

- [Website](https://sverklo.com)
- [npm](https://www.npmjs.com/package/sverklo)
- [Issues](https://github.com/sverklo/sverklo/issues)

## License

MIT

# Sverklo

**Other tools remember your conversations. Sverklo understands your code.**

Local-first code intelligence MCP with hybrid semantic search, symbol-level impact analysis, and bi-temporal memory tied to git state. Runs entirely on your machine. No API keys. No cloud. No data leaves your laptop.

```bash
npm install -g sverklo
cd your-project && sverklo init
```

That's it. `sverklo init` writes `.mcp.json` at your project root, adds sverklo instructions to `CLAUDE.md`, auto-allows the sverklo tools, and runs `sverklo doctor` to verify the setup.

---

## When sverklo helps (and when it doesn't)

We're honest about this — sverklo isn't a magic 5× speedup. It's a sharper tool for specific kinds of work.

### Sverklo wins on
- **Exploratory questions** — "what replaced this deleted code?", "how does the auth flow work?", "what's related to billing?"
- **Refactor blast radius** — `sverklo_impact <symbol>` walks the symbol graph and tells you exactly who calls it. Fewer false positives than grep on common names.
- **Large interconnected codebases** — when grep returns 200 matches and you don't know which are relevant, semantic ranking + PageRank surfaces the load-bearing code first.
- **Memory across sessions** — `sverklo_remember`/`sverklo_recall` keeps decisions and patterns alive after context compaction. Tied to git SHA so you know what the code looked like when the decision was made.
- **Project audits** — `sverklo_audit` surfaces god nodes, hub files, dead code candidates in one call.

### Built-in tools win on
- **Focused diff review** — for a signature change or a single-file refactor, `git diff` + `Read` + targeted `Grep` is hard to beat.
- **Exact string matching** — "does this literal string exist anywhere?" → `Grep` is faster and more reliable.
- **Reading file contents** — only `Read` does this. Sverklo isn't a file reader.
- **Build and test verification** — only `Bash` runs `npm test` or `gradle check`.

The honest pattern: **sverklo is the right tool when you don't know exactly what to search for**. When you do know, grep is fine.

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

### Google Antigravity
Antigravity uses a **global** MCP config file (no per-project config — known limitation, see [Google forum](https://discuss.ai.google.dev/t/support-for-per-workspace-mcp-config-on-antigravity/111952)). `sverklo init` writes it for you if Antigravity is installed, otherwise edit the file by hand:

`~/.gemini/antigravity/mcp_config.json` (Windows: `C:\Users\<USER>\.gemini\antigravity\mcp_config.json`)

```json
{
  "mcpServers": {
    "sverklo": {
      "command": "/full/path/to/sverklo",
      "args": ["/absolute/path/to/your/project"]
    }
  }
}
```

Restart Antigravity after editing. To verify, open the side panel → **MCP Servers** → **Manage MCP Servers** — sverklo should appear in the list. Because the config is global, if you work on multiple projects you'll need to either re-run `sverklo init` from each (it rewrites the path) or run a separate sverklo instance per project under different keys (`sverklo-projA`, `sverklo-projB`).

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

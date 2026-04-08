# Sverklo

[![npm version](https://img.shields.io/npm/v/sverklo.svg?color=E85A2A)](https://www.npmjs.com/package/sverklo)
[![npm downloads](https://img.shields.io/npm/dw/sverklo.svg?color=E85A2A)](https://www.npmjs.com/package/sverklo)
[![GitHub stars](https://img.shields.io/github/stars/sverklo/sverklo?style=flat&color=E85A2A)](https://github.com/sverklo/sverklo)
[![License: MIT](https://img.shields.io/badge/license-MIT-E85A2A.svg)](LICENSE)
[![Local-first](https://img.shields.io/badge/local--first-no%20cloud-E85A2A)](#)

**Other tools remember your conversations. Sverklo understands your code.**

Local-first code intelligence MCP for **Claude Code, Cursor, Windsurf, VS Code, JetBrains, and Google Antigravity**. Hybrid semantic search, symbol-level impact analysis, diff-aware MR review with risk scoring, and bi-temporal memory tied to git state. Runs entirely on your machine. No API keys. No cloud. No data leaves your laptop.

```bash
npm install -g sverklo
cd your-project && sverklo init
```

That's it. `sverklo init` auto-detects your installed AI coding agents, writes the right MCP config files, appends sverklo instructions to your `CLAUDE.md`, and runs `sverklo doctor` to verify the setup.

> **First 5 minutes:** see [`FIRST_RUN.md`](FIRST_RUN.md) for three scripted prompts that demonstrate the tools sverklo adds that grep can't replace.

---

## When to reach for sverklo

We're honest about this — sverklo isn't a magic 5× speedup. It's a sharper tool for specific jobs. Three concrete moments where it earns its keep:

### "I'm renaming a public method on a billing-critical class"
Grep `\.charge(` returns 312 matches polluted by `recharge`, `discharge`, an unrelated `Battery.charge` test fixture, and a 2021 comment. `sverklo_impact BillingAccount.charge` walks the symbol graph and returns the **14 real callers** with file paths and line numbers, ranked by depth. Paste that into your agent as a checklist and the rename is mechanical.

### "I'm reviewing a 40-file PR and don't know what to read first"
`sverklo_review_diff` analyzes the diff, computes a risk score per file (touched-symbol importance × test coverage × historical churn), flags files with no test changes against modified production code, and gives your agent a prioritized review order. `sverklo_test_map` shows which tests cover which changed symbols. The agent reviews like a senior dev because it's reading in the order a senior dev would.

### "I'm onboarding to a new repo and need to know what's load-bearing"
`sverklo_overview` runs PageRank over the dependency graph and surfaces the structurally important files — not the ones with the most lines, the ones the rest of the codebase depends on. `sverklo_audit` flags god nodes, hub files, and dead code candidates in one call. Five minutes to a real mental model instead of two hours of clicking around.

### When grep is still the right tool

Sverklo is the right tool when **you don't know exactly what to search for**. When you do, grep is fine and we tell you so:

- **Exact string matching** — "does this literal string exist anywhere?" → `Grep` is faster and more reliable.
- **Reading file contents** — only `Read` does this. Sverklo isn't a file reader.
- **Build and test verification** — only `Bash` runs `npm test` or `gradle check`.
- **Focused single-file diffs** — for a signature change in one file, `git diff` + `Read` is hard to beat.

If a launch post tells you a tool is great for everything, close the tab.

---

## Twenty tools your agent actually uses

Grouped by job. Every tool runs locally, every tool is free.

### Search — find code without knowing the literal string
| Tool | What |
|------|------|
| `sverklo_search` | Hybrid BM25 + ONNX vector + PageRank, fused with Reciprocal Rank Fusion |
| `sverklo_overview` | Structural codebase map ranked by PageRank importance |
| `sverklo_lookup` | Find any function, class, or type by name (typo-tolerant) |
| `sverklo_context` | One-call onboarding — combines overview, code, and saved memories |
| `sverklo_ast_grep` | Structural pattern matching across the AST, not just text |

### Impact — refactor without the regression
| Tool | What |
|------|------|
| `sverklo_impact` | Walk the symbol graph, return ranked transitive callers (the real blast radius) |
| `sverklo_refs` | Find all references to a symbol, with caller context |
| `sverklo_deps` | File dependency graph — both directions, importers and imports |
| `sverklo_audit` | Surface god nodes, hub files, dead code candidates in one call |

### Review — diff-aware MR review with risk scoring
| Tool | What |
|------|------|
| `sverklo_review_diff` | Risk-scored review of `git diff` — touched-symbol importance × coverage × churn |
| `sverklo_test_map` | Which tests cover which changed symbols; flag untested production changes |
| `sverklo_diff_search` | Semantic search restricted to the changed surface of a diff |

### Memory — bi-temporal, git-aware, never stale
| Tool | What |
|------|------|
| `sverklo_remember` | Save decisions, patterns, invariants — pinned to the current git SHA |
| `sverklo_recall` | Semantic search over saved memories with staleness detection |
| `sverklo_memories` | List all memories with health metrics (still valid / stale / orphaned) |
| `sverklo_forget` | Delete a memory |
| `sverklo_promote` / `sverklo_demote` | Move memories between tiers (project / global / archived) |

### Index health
| Tool | What |
|------|------|
| `sverklo_status` | Index health check, file counts, last update |
| `sverklo_wakeup` | Warm the index after a long pause; incremental refresh |

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

Real measurements on real codebases (full methodology and reproducer in [`BENCHMARKS.md`](./BENCHMARKS.md)):

| Repo | Files | Cold index | Search p95 | Impact analysis | DB size |
|---|---:|---:|---:|---:|---:|
| [gin-gonic/gin](https://github.com/gin-gonic/gin) | 99 | 10 s | 12 ms | 0.75 ms | 4 MB |
| [nestjs/nest](https://github.com/nestjs/nest) | 1,709 | 22 s | 14 ms | 0.88 ms | 11 MB |
| [facebook/react](https://github.com/facebook/react) | 4,368 | 152 s | 26 ms | 1.18 ms | 67 MB |

- **Search latency stays under 26 ms p95** even on a 4k-file React monorepo
- **Impact analysis is sub-millisecond** on every repo we tested — it's an indexed SQL join, not a string scan
- **Cold-start indexing is linear in chunks** (~7 ms/chunk on Apple Silicon). Pay it once per project; incremental refresh after that only re-processes changed files
- **Steady-state RAM is ~200 MB** after indexing finishes. Peak during indexing is 400–700 MB while the embedder batches chunks
- **Languages:** 10 (TS, JS, Python, Go, Rust, Java, C, C++, Ruby, PHP)
- **Dependencies:** zero config, zero API keys, zero cloud calls (after the one-time ~90 MB ONNX model download)

## Why not... (as of 2026-04)

| Alternative | Local | OSS | Code search | Symbol graph | Memory | MR review | Cost |
|---|---|---|---|---|---|---|---|
| **Sverklo** | ✓ | ✓ MIT | ✓ hybrid + PageRank | ✓ | ✓ git-aware | ✓ risk-scored | $0 |
| Built-in grep / Read | ✓ | ✓ | text only | ✗ | ✗ | ✗ | $0 |
| [Cursor's @codebase](https://docs.cursor.com/context/codebase-indexing) | ✗ cloud | ✗ | ✓ | partial | ✗ | ✗ | with Cursor sub |
| [Sourcegraph Cody](https://sourcegraph.com/cody) | ✗ cloud | ✗ source-available | ✓ | ✓ | ✗ | partial | $9–19/dev/mo |
| [Continue.dev](https://continue.dev) | partial | ✓ | ✓ basic | ✗ | ✗ | ✗ | $0 |
| [Claude Context (Zilliz)](https://github.com/zilliztech/claude-context) | ✗ Milvus | ✓ | ✓ vector only | ✗ | ✗ | ✗ | $0 + Milvus |
| [Aider repo-map](https://aider.chat/docs/repomap.html) | ✓ | ✓ | ✗ | ✓ basic | ✗ | ✗ | $0 |
| [Greptile](https://greptile.com) | ✗ cloud | ✗ | ✓ | ✓ | ✗ | ✓ | $30/dev/mo |
| [Augment](https://augmentcode.com) | ✗ cloud | ✗ | ✓ | ✓ | ✗ | partial | $20–200/mo |
| [claude-mem](https://github.com/themanojdesai/claude-mem) | ✓ | ✓ | ✗ | ✗ | ✓ ChromaDB | ✗ | $0 |

Sverklo is the only tool that combines **hybrid code search + symbol graph + memory + diff-aware review** in one local-first MCP server.

## Configuration

| Setting | Location |
|---------|----------|
| Model files | `~/.sverklo/models/` (auto-downloaded) |
| Index database | `~/.sverklo/<project>/index.db` |
| Custom ignores | `.sverkloignore` in project root |
| Debug logging | `SVERKLO_DEBUG=1` |

## Telemetry

**Off by default.** Sverklo ships zero telemetry until you explicitly run `sverklo telemetry enable`. If you never run that command, sverklo never makes a network call beyond the one-time embedding model download on first run.

If you do opt in, we collect 9 fields per event: a random install ID (generated locally), sverklo version, OS, Node major version, the event type (one of 17 fixed enum values), the tool name when applicable, the outcome (ok/error/timeout), and the duration in ms. Server-side we add a Unix timestamp.

**We never collect:** code, queries, file paths, symbol names, memory contents, git SHAs, branches, repo URLs, IP addresses, hostnames, error messages, language breakdowns, or anything else that could identify you or your codebase.

Every event is mirrored to `~/.sverklo/telemetry.log` **before** the network call so you can `tail -f` it and see exactly what gets sent. The endpoint is a Cloudflare Worker we own at `t.sverklo.com`, the source lives in [`telemetry-endpoint/`](./telemetry-endpoint/), retention is 90 days, and the entire client implementation is one file under 250 lines at [`src/telemetry/index.ts`](./src/telemetry/index.ts).

Read [`TELEMETRY.md`](./TELEMETRY.md) for the full schema, the 17 event types, what we deliberately don't collect, and how to verify it. The design rationale and locked decisions are in [`TELEMETRY_DESIGN.md`](./TELEMETRY_DESIGN.md).

```bash
sverklo telemetry status    # show current state
sverklo telemetry enable    # opt in (interactive, prints schema first)
sverklo telemetry disable   # opt out, permanent per machine
sverklo telemetry log       # show every event that was sent
```

## Open Source, Open Core

The full MCP server is **free and open source** (MIT). All 20 tools, no limits, no telemetry, no "free tier" — that's not where the line is.

**Sverklo Pro** (later this year) adds smart auto-capture of decisions, cross-project pattern learning, and larger embedding models.

**Sverklo Team** (later this year) adds shared team memory and on-prem deployment.

The open-core line is **"Pro adds new things, never gates current things."** Anything in the OSS server today stays in the OSS server forever.

## Links

- [Website](https://sverklo.com)
- [npm](https://www.npmjs.com/package/sverklo)
- [Issues](https://github.com/sverklo/sverklo/issues)

## License

MIT

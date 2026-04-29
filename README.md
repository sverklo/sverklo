<p align="left">
  <img src="./docs/logo.svg" alt="sverklo" width="280" height="79"/>
</p>

<p align="left">
  🇬🇧 <b>English</b> · 🇨🇳 <a href="./README-zh-CN.md">中文</a>
</p>

> *"The map is not the territory."* — Alfred Korzybski
>
> Training data is the map. Your codebase is the territory. **Sverklo gives the agent the territory.**

**The only code-intel MCP with a published benchmark and reproducible eval harness.** Local-first MCP server that gives Claude Code, Cursor, Windsurf, and Zed a real symbol graph, a blast-radius lens, and a git-pinned memory — so the agent stops guessing. MIT. Zero config. Your code never leaves the machine.

[Paper (Zenodo, CC BY 4.0)](https://doi.org/10.5281/zenodo.19802051) · [bench:primitives](https://sverklo.com/bench/) — **62× fewer tokens than naive grep**, 2.9× fewer than tuned grep, single tool call vs grep's 7-12 (n=60) · [bench:swe](https://sverklo.com/blog/bench-swe-first-results/) — 38/65 perfect recall on 5 OSS repos, including the runs we lose.

### One-click install

[![Install in Claude Code](https://img.shields.io/badge/Claude_Code-Install_Plugin-CC785C?style=for-the-badge&logoColor=white)](#claude-code) [![Install in Cursor](https://img.shields.io/badge/Cursor-Install_MCP-F14C28?style=for-the-badge&logo=cursor&logoColor=white)](cursor://anysphere.cursor-deeplink/mcp/install?name=sverklo&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsInN2ZXJrbG8iXX0=) [![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_MCP-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=sverklo&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22sverklo%22%5D%7D) [![Install in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install_MCP-24bfa5?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=sverklo&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22sverklo%22%5D%7D&quality=insiders) [![Install in Windsurf](https://img.shields.io/badge/Windsurf-sverklo_init-09B6A2?style=for-the-badge&logoColor=white)](#windsurf--zed--vs-code--jetbrains)

[![npm version](https://img.shields.io/npm/v/sverklo.svg?color=E85A2A)](https://www.npmjs.com/package/sverklo)
[![npm downloads](https://img.shields.io/npm/dw/sverklo.svg?color=E85A2A)](https://www.npmjs.com/package/sverklo)
[![License: MIT](https://img.shields.io/badge/license-MIT-E85A2A.svg)](LICENSE)
[![Audited repos](https://img.shields.io/badge/audited_repos-47-E85A2A)](https://sverklo.com/report)
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.19802051.svg)](https://doi.org/10.5281/zenodo.19802051)
[![GitHub stars](https://img.shields.io/github/stars/sverklo/sverklo?style=social)](https://github.com/sverklo/sverklo/stargazers)

> ⭐ **If sverklo saved your AI from hallucinating, please star this repo** — it's the single most useful thing you can do to help others find it. Then [share with one teammate](https://twitter.com/intent/tweet?text=Local-first%20MCP%20code%20intelligence%20for%20AI%20coding%20agents%20%E2%80%94%20MIT%2C%20zero-deps%2C%20honest%20benchmark%20%40%20https%3A%2F%2Fsverklo.com%2Fbench%2F) who's tired of `getUserByEmail()` not existing in their codebase.

![Sverklo cuts agent context by 65 % vs grep — bench:primitives, 60 retrieval tasks, peer-reviewable](./docs/hero-token-comparison.png)

![Sverklo demo — audit and badge](./docs/demo.gif)

## Why

Your AI agent edits `UserService.validate()`. It doesn't know 47 other functions call it. It hallucinates `getUserByEmail()` because that's how its training data spelled it — your code uses `findByEmail()`. It forgets the design decision you made yesterday because context was compacted. Tests pass because they mock the dependency. Breaking changes ship.

Sverklo drills into your repo before the agent does — symbol graph, blast radius, semantic recall, and git-pinned memory — so the agent reasons about *your* code instead of pattern-matching from training data.

<table>
<tr>
<td align="center"><b>37</b><br/>MCP tools your agent uses</td>
<td align="center"><b>&lt; 1 s</b><br/>incremental refresh after each edit</td>
<td align="center"><b>0 bytes</b><br/>of your code leave the machine</td>
</tr>
</table>

```bash
npm install -g sverklo
cd your-project && sverklo init
```

That's it. `sverklo init` auto-detects your installed AI coding agent (Claude Code, Cursor, Windsurf, Zed), writes the right MCP config, appends instructions to `AGENTS.md` if present (otherwise `CLAUDE.md`), and runs `sverklo doctor` to verify the setup. Works on macOS, Linux, and Windows. **No API keys. No cloud. Telemetry off by default.**

> The embedding model (`all-MiniLM-L6-v2` ONNX, ~86 MB) is downloaded from HuggingFace on first use into `~/.sverklo/models/` and cached forever — every subsequent run is fully offline.

**Want proof before installing?** Browse the [/report leaderboard](https://sverklo.com/report) — Sverklo audits of 47 popular OSS repos (express, react-hook-form, vite, lodash, prisma, …) with grade cards for dead code, circular deps, coupling, and security.

---

## What's new in 0.18

- **Vue.js (.vue) support.** Single-file components are now first-class: the `<script>` block parses through the existing TS/JS pipeline (with line remapping back to the SFC), Composition API helpers (`ref`, `computed`, `reactive`, `defineProps`, …) are indexed as symbols, and PascalCase template tags emit relative imports so PageRank sees component graphs. Also fixes a preexisting TS bug where `import type { X } from 'y'` was missed.
- **AGENTS.md aware `sverklo init`.** When [AGENTS.md](https://agents.md) exists, the prefer-sverklo block is appended there instead of `CLAUDE.md`. `sverklo doctor` flags drift between the two files so multi-agent setups stay in sync.
- **Windows pathing fixed.** `sverklo init` and `sverklo doctor` now work on Windows — absolute paths go through `path.basename()` and stored `relativePath` is normalized to forward slashes so every downstream consumer is cross-platform.
- **`npm run bench:swe`** — third-party-reproducible cross-repo eval. Clones 5 OSS repos (express, nestjs, vite, prisma, fastapi), runs 65 grounded questions, prints aggregated recall. PRs that add questions are welcome.
- **Tree-sitter parser opt-in.** `sverklo grammars install` (~3.5 MB across 6 languages) + `SVERKLO_PARSER=tree-sitter` routes the indexer through real ASTs for TypeScript/TSX/JavaScript/Python/Go/Rust. Silent regex fallback when grammars aren't installed. Plan to flip the default lives in [docs/parser-parity.md](./docs/parser-parity.md).
- **Workspace shared memory.** `sverklo workspace memory <name> add/list/search` plus `sverklo_remember scope:"workspace"` from the agent — write a decision once, query it from every other repo in the workspace. `sverklo_recall` blends workspace results under project ones with a `[ws]` badge.
- **`sverklo memory export`** — markdown / Notion / JSON. Migrate your team's decision log to wherever it actually lives.
- **PR-bot inline review.** `sverklo review --format github-review-json` + the action's new `inline-comments: true` default posts per-line review comments via `pulls.createReview`, alongside the existing sticky summary.
- **VS Code extension scaffold** at [`extensions/vscode/`](./extensions/vscode/) with a pre-built `sverklo-vscode-0.1.0.vsix`. Inline caller-count decorations on every function header (`⟵ 47 callers`). Marketplace publish workflow ships dormant; install with `code --install-extension extensions/vscode/sverklo-vscode-0.1.0.vsix` today.
- **`sverklo digest [--since 7d]`** — 5-line summary of audit-grade trend, new vs stale memories, and high-PageRank files touched. Wire into a shell-hook on `cd` for a daily sverklo check-in.

---

## Grep vs Sverklo — the same question, side by side

Every one of these is a query a real engineer asked a real AI assistant last week. Grep gives you lines. Sverklo gives you a ranked answer.

| The question | With Grep | With Sverklo |
|---|---|---|
| "Where is auth handled in this repo?" | `grep -r 'auth' .` -- 847 matches across tests, comments, unrelated vars, and one 2021 TODO | `sverklo_search "authentication flow"` -- top 5 files ranked by PageRank: middleware, JWT verifier, session store, login route, logout route |
| "Can I safely rename `BillingAccount.charge`?" | `grep '\.charge('` -- 312 matches polluted by `recharge`, `discharge`, `Battery.charge` fixtures | `sverklo_impact BillingAccount.charge` -- 14 real callers, depth-ranked, with file paths and line numbers |
| "Is this helper actually used anywhere?" | `grep -r 'parseFoo' .` -- 4 matches in 3 files. Are any real, or just string mentions? Read each one. | `sverklo_refs parseFoo` -- 0 real callers. Zero. Walk the symbol graph, not the text. Delete the function. |
| "What's load-bearing in this codebase?" | `find . -name '*.ts' \| xargs wc -l \| sort` -- the biggest files. Not the most important ones. | `sverklo_overview` -- PageRank over the dep graph. The files the rest of the repo depends on, not the ones someone wrote too much code in. |
| "Review this 40-file PR — what should I read first?" | Read them in the order git diff printed them | `sverklo_review_diff` -- risk-scored per file (touched-symbol importance x coverage x churn), prioritized order, flagged production files with no test changes |

If the answer to your question is "exact string X exists somewhere," grep wins. Use grep. If the answer is "which 5 files actually matter here, ranked by the graph," you need sverklo.

---

## Works with every MCP editor

| Editor | MCP | Skills | Hooks | Auto-setup |
|--------|:---:|:------:|:-----:|:----------:|
| Claude Code | yes | yes | yes | `sverklo init` |
| Cursor | yes | — | — | `sverklo init` |
| Windsurf | yes | — | — | `sverklo init` |
| Zed | yes | — | — | `sverklo init` |
| VS Code | yes | — | — | manual |
| JetBrains | yes | — | — | manual |
| Antigravity | yes | — | — | `sverklo init` |
| Any MCP client | yes | — | — | `npx sverklo /path` |

---

## Hero tools

| Tool | What it does |
|------|-------------|
| `sverklo_search` | Hybrid BM25 + vector + PageRank search. Find code without knowing the literal string. |
| `sverklo_refs` | All references to a symbol, with caller context. Proves dead code with certainty. |
| `sverklo_impact` | Walk the symbol graph, return ranked transitive callers — the real blast radius. |
| `sverklo_review_diff` | Risk-scored review of `git diff`: touched-symbol importance x coverage x churn. |

[See all 37 tools below.](#full-tool-reference)

<details>
<summary><h2>Full tool reference</h2></summary>

### Search — find code without knowing the literal string
| Tool | What |
|------|------|
| `sverklo_search` | Hybrid BM25 + ONNX vector + PageRank, fused with Reciprocal Rank Fusion |
| `sverklo_search_iterative` | Wider candidate pool with refinement hints between rounds |
| `sverklo_investigate` | Parallel multi-channel fan-out (FTS / vector / path / symbol) with per-channel RRF |
| `sverklo_ask` | Natural-language router — concepts + investigate + refs in one call |
| `sverklo_overview` | Structural codebase map ranked by PageRank importance |
| `sverklo_lookup` | Find any function, class, or type by name (typo-tolerant) |
| `sverklo_context` | One-call onboarding — combines overview, code, and saved memories |
| `sverklo_ast_grep` | Structural pattern matching across the AST, not just text |
| `sverklo_concepts` | Browse the LLM-derived concept index (themes across the codebase) |
| `sverklo_clusters` | Semantic clusters of related symbols, computed offline |
| `sverklo_patterns` | Query symbols tagged with a design pattern (observer, repository, validator, ...) |

### Impact — refactor without the regression
| Tool | What |
|------|------|
| `sverklo_impact` | Walk the symbol graph, return ranked transitive callers (the real blast radius) |
| `sverklo_refs` | Find all references to a symbol, with caller context |
| `sverklo_deps` | File dependency graph — both directions, importers and imports |
| `sverklo_audit` | **Lint your codebase for AI-readiness.** God nodes, hub files, dead code, circular deps, security smells, A-F health grade — all in one call |

### Review — diff-aware MR review with risk scoring
| Tool | What |
|------|------|
| `sverklo_review_diff` | Risk-scored review of `git diff` — touched-symbol importance x coverage x churn |
| `sverklo_critique` | Second-pass critique of a review — what did the first read miss |
| `sverklo_test_map` | Which tests cover which changed symbols; flag untested production changes |
| `sverklo_diff_search` | Semantic search restricted to the changed surface of a diff |
| `sverklo_verify` | Verify a quoted code span is still present at the cited SHA — citation gate |

### Memory — bi-temporal, git-aware, never stale
| Tool | What |
|------|------|
| `sverklo_remember` | Save decisions, patterns, invariants — pinned to the current git SHA |
| `sverklo_recall` | Semantic search over saved memories with staleness detection |
| `sverklo_memories` | List all memories with health metrics (still valid / stale / orphaned) |
| `sverklo_forget` | Delete a memory |
| `sverklo_promote` / `sverklo_demote` | Move memories between tiers (core / archive) |
| `sverklo_pin` / `sverklo_unpin` | Pin a memory to a file path or symbol so recall surfaces it without semantic search |

### Post-filter primitives — refine the last response without re-querying
| Tool | What |
|------|------|
| `sverklo_grep_results` | Grep inside the previous result block instead of re-running the search |
| `sverklo_head_results` | Take the first N hits from the previous response |
| `sverklo_ctx_peek` | Peek at a referenced span by its handle without expanding it fully |
| `sverklo_ctx_slice` | Slice a stored response by line range |
| `sverklo_ctx_grep` | Grep within a stored context window |
| `sverklo_ctx_stats` | Token-budget stats for stored response handles |

### Index health
| Tool | What |
|------|------|
| `sverklo_status` | Index health check, file counts, last update |
| `sverklo_wakeup` | 500-token codebase summary for system prompts on agents that can't run MCP |

</details>

---

## When to reach for sverklo — and when not to

We're honest about this. Sverklo isn't a magic 5x speedup and it doesn't replace grep. It's a sharper tool for specific jobs.

**When sverklo earns its keep:**
- You don't know exactly what to search for
- You need to prove dead code (zero references across the whole symbol graph)
- You need the blast radius of a refactor before you start
- You're reviewing a large PR and need to know what to read first

**When grep is still the right tool:**
- Exact string matching — "does this literal string exist?"
- Small codebases under ~50 source files — just read everything
- Single-file diffs — `git diff` + `Read` is hard to beat
- Build and test verification — only `Bash` runs `npm test`

If a launch post tells you a tool is great for everything, close the tab.

---

## Common questions

### How do I stop Claude Code from hallucinating about my codebase?

Claude generates code from training-data patterns, not your repo. Without a symbol graph, it invents `getUserByEmail()` when your code uses `findByEmail()`. Sverklo grounds the agent in your actual symbol graph — `sverklo_lookup` and `sverklo_refs` resolve names to `file:line` and prove existence before the agent writes the call. Verifiable retrieval (`sverklo_verify`) lets the agent re-check that a quoted span is still present at the cited SHA, so a stale citation gets caught instead of confabulated.

### Is there a local-first MCP server for codebase memory?

Yes — sverklo. `sverklo_remember` and `sverklo_recall` ship a bi-temporal memory layer: every memory is pinned to the git SHA it was authored on, and `valid_until_sha` + `superseded_by` preserve a timeline of supersessions instead of overwriting. Recall is hybrid (FTS5 + cosine over an ONNX embedding) and runs entirely in embedded SQLite. No cloud, no API keys, no external vector database — unlike most "memory MCP" projects which require Zilliz, Milvus, or a managed Postgres+pgvector.

### Is there an open-source alternative to Sourcegraph Cody I can run locally?

Sverklo is the open-source local alternative to Sourcegraph Cody for codebase Q&A: hybrid BM25 + vector + PageRank retrieval, symbol-graph navigation, MIT-licensed instead of source-available, single-machine instead of Cody's enterprise deployment, and free instead of $9–19 per developer per month. Sverklo doesn't try to ship the same feature set — it's a primitives layer for AI coding agents (37 MCP tools), not a hosted IDE plug-in — but for the "give the agent semantic understanding of my codebase" job, it covers the same surface.

### Where does my code go when I use sverklo?

Nowhere. Sverklo runs entirely on your machine. Indexing, search, embeddings, audits, and PR review all execute locally with embedded SQLite plus a local ONNX embedding model. The model itself is downloaded from HuggingFace on first run (~86 MB), cached in `~/.sverklo/models/`, and never touched again. Telemetry is opt-in and off by default — sverklo makes zero network calls unless you explicitly run `sverklo telemetry enable`.

### Does sverklo work with Cursor's @codebase or Cursor Tab?

Sverklo runs alongside Cursor's built-in indexing rather than replacing it. Cursor's @codebase ships embedding-based search inside the IDE; sverklo adds the symbol graph, blast radius, diff-aware risk-scored review, and bi-temporal memory that Cursor doesn't expose. Wire sverklo as an MCP server in Cursor and both layers are available to the agent simultaneously. The same setup works for Claude Code, Windsurf, Zed, Antigravity, and anything else that speaks MCP.

---

## Three retrieval techniques you'll only find here

Most code-search MCPs are a single BM25 + vector RRF on top of Milvus or pgvector. Sverklo's recall is built on three named moves that work because they exploit *codebase structure*, not just text similarity. Each one was added to close a real recall failure on real questions; together they're the reason sverklo's research benchmark hits 99% recall (31 of 32) without a managed vector database.

### 1. Filename-as-signal retrieval

When a query token matches a *filename* — even when the body of that file doesn't FTS-match — sverklo pulls every named definition in that file into the candidate set. Conversely, when FTS surfaces a file at all (because of a comment hit, an import line, anything), every definition in that file becomes a plausible answer. This is the single move that closes the "private helper function" gap: the function is too short for embeddings to disambiguate and uses a name no one would `grep` for, but it lives next to the code that *does* match. Implemented in `src/search/investigate.ts` (`runDefinitionsByPathTokens`, `runDefinitionsInFtsFiles`).

### 2. Channelized RRF fusion

Most hybrid retrievers run *one* Reciprocal Rank Fusion over `fts ∪ vector` and call it a day. Sverklo runs RRF *per channel* — FTS, vector, doc-section, path, symbol-name — then fuses the per-channel ranks with channel-specific weights. The path channel is weighted **1.5×** because filename matches are precision-skewed; doc chunks score in their own channel so a 200-line markdown section can't drown a 4-line function body. This is structural retrieval, not just lexical-vs-semantic. Implemented in `src/search/investigate.ts` (per-channel RRF + weighted fusion).

### 3. Bi-temporal memory with `superseded_by` lineage

Every memory carries `valid_from_sha` and `valid_until_sha`. Updating a memory doesn't overwrite — it inserts a new row, sets `valid_until_sha` on the old one, and links them via `superseded_by`. Recall queries naturally exclude invalidated rows, but the timeline view keeps everything, so you can ask "what did this team believe about the auth flow at commit `abc123`?" and get the answer that was true *then*. `sverklo prune` consolidates clusters of similar episodic memories into one semantic note while preserving the lineage. Implemented across `src/storage/memory-store.ts` and `src/memory/prune.ts`.

---

## How It Works

```mermaid
graph LR
    A[Your Code] --> B[Parse<br/>11 languages]
    B --> C[Embed<br/>ONNX/Ollama]
    B --> D[Build Graph<br/>imports/exports]
    D --> E[PageRank<br/>importance]
    
    F[Agent Query] --> G[BM25]
    F --> H[Vector Search]
    E --> I[PageRank Boost]
    G --> J[RRF Fusion]
    H --> J
    I --> J
    J --> K[Token-Budgeted<br/>Response]
```

1. **Parses** your codebase into functions, classes, types (TS, JS, Vue, Python, Go, Rust, Java, C, C++, Ruby, PHP)
2. **Embeds** code using all-MiniLM-L6-v2 ONNX model (384d, fully local) — or any Ollama model via config
3. **Builds** a dependency graph and computes PageRank (structurally important files rank higher)
4. **Searches** using hybrid BM25 + vector similarity + PageRank, fused via Reciprocal Rank Fusion
5. **Remembers** decisions and patterns across sessions, linked to git state
6. **Watches** for file changes and updates incrementally

---

## Performance

Real measurements on real codebases. Reproducible via `npm run bench` ([methodology](./BENCHMARKS.md)).

| Repo | Files | Cold index | Search p95 | Impact analysis | DB size |
|---|---:|---:|---:|---:|---:|
| [gin-gonic/gin](https://github.com/gin-gonic/gin) | 99 | 10 s | 12 ms | 0.75 ms | 4 MB |
| [nestjs/nest](https://github.com/nestjs/nest) | 1,709 | 22 s | 14 ms | 0.88 ms | 11 MB |
| [facebook/react](https://github.com/facebook/react) | 4,368 | 152 s | 26 ms | 1.18 ms | 67 MB |

- **Search p95 stays under 26 ms** even on a 4k-file monorepo
- **Impact analysis is sub-millisecond** — indexed SQL join, not a string scan
- **11 languages:** TS, JS, Vue, Python, Go, Rust, Java, C, C++, Ruby, PHP

### Retrieval benchmark — bench:primitives

Hybrid retrieval F1 vs grep baselines on a 60-task hand-verified evaluation across two OSS codebases. Public report at **[sverklo.com/bench/](https://sverklo.com/bench/)** — including the slice where sverklo *loses* (P5 dead-code detection, F1 = 0.02).

| baseline | F1 | input tokens | tool calls |
|---|---:|---:|---:|
| naive-grep | 0.35 | 15,814 | 7.6 |
| smart-grep (tuned) | 0.67 | 731 | 11.8 |
| **sverklo** | 0.58 | **255** | **1.0** |

A tuned grep beats sverklo on F1. Sverklo wins decisively on token economy (62× fewer than naive grep, 2.9× fewer than tuned grep) and tool-call count, which is the load-bearing axis for AI agents with bounded context windows. Reproduce with `npm run bench:primitives`.

---

## Quick Start

### Claude Code

```bash
npm install -g sverklo
cd your-project && sverklo init
```

Creates `.mcp.json` at your project root and appends sverklo instructions to `CLAUDE.md`. Safe to re-run. If sverklo doesn't appear in `/mcp` after restart, run `sverklo doctor`.

### Cursor / Windsurf / VS Code / JetBrains

Use the full binary path (`which sverklo`) to avoid PATH issues in spawned subprocesses:

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

Config locations: `.cursor/mcp.json`, `~/.windsurf/mcp.json`, `.vscode/mcp.json`, or JetBrains Settings -> Tools -> MCP Servers.

### Antigravity

`sverklo init` writes the global config at `~/.gemini/antigravity/mcp_config.json`. Because Antigravity lacks per-project MCP config, you'll need to re-run `sverklo init` from each project or use separate keys (`sverklo-projA`, `sverklo-projB`).

### Any MCP client

```bash
npx sverklo /path/to/your/project
```

> **First run:** The ONNX embedding model (~90 MB) downloads automatically. Takes ~30 seconds on first launch, then instant.

---

## Why not... (as of 2026-04)

| Alternative | Local | OSS | Code search | Symbol graph | Memory | MR review | License | Cost |
|---|---|---|---|---|---|---|---|---|
| **Sverklo** | yes | yes MIT | hybrid + PageRank | yes | git-aware | risk-scored | MIT | $0 |
| Built-in grep / Read | yes | yes | text only | no | no | no | varies | $0 |
| [Cursor @codebase](https://docs.cursor.com/context/codebase-indexing) | no (cloud) | no | yes | partial | no | no | proprietary | with Cursor sub |
| [Sourcegraph Cody](https://sourcegraph.com/cody) | no (cloud) | no | yes | yes | no | partial | source-available | $9-19/dev/mo |
| [Claude Context (Zilliz)](https://github.com/zilliztech/claude-context) | no (Milvus) | yes | vector only | no | no | no | MIT | $0 + Milvus |
| [Aider repo-map](https://aider.chat/docs/repomap.html) | yes | yes | no | basic | no | no | Apache 2.0 | $0 |
| [Greptile](https://greptile.com) | no (cloud) | no | yes | yes | no | yes | proprietary | $30/dev/mo |

---

## Lint for AI-readiness — `sverklo audit`

Most lints check syntax. `sverklo audit` lints whether your codebase is **legible to an AI agent**: high blast-radius "god nodes" the agent will trip on, hub files that cascade widely on every change, orphan symbols that might be dead code or might be public API, circular dependencies that confuse the symbol graph, and a security smell scan. Outputs an A-F health grade you can pin as a README badge.

```bash
sverklo audit                     # markdown report in the terminal
sverklo audit --format html --open  # self-contained HTML you can share
sverklo audit --badge             # A-F shield markdown for your README
sverklo audit --format sarif      # GitHub code-scanning alerts
sverklo audit --format json       # machine-readable for CI gates
```

Six formats: `markdown`, `html`, `json`, `sarif`, `csv`, `badges`. Pair with `sverklo_impact` (the MCP tool) when you want to see the per-symbol blast radius before refactoring.

---

## CLI tools

Sverklo ships a CLI for CI and local use: `sverklo review --ci --fail-on high` for risk-scored diff review (auto-detects PR ref in GitHub Actions), `sverklo audit` for codebase health reports, and a [GitHub Action](./action) that posts review comments on PRs. Run `sverklo audit-prompt` or `sverklo review-prompt` to get battle-tested workflow prompts you can paste into any agent.

---

## Claude Code hooks recipe

Sverklo plays well with [Claude Code hooks](https://docs.claude.com/claude-code/hooks). The simplest hook to wire is a post-tool-use review: after Claude makes file edits, run `sverklo review` against the working tree and surface any high-risk findings in the agent transcript. Add this to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "sverklo review --ref HEAD --format json --fail-on high || true"
          }
        ]
      }
    ]
  }
}
```

The trailing `|| true` keeps the hook from blocking edits when sverklo isn't installed or the working tree has no diff yet. For project-scoped hooks, put the same block in `.claude/settings.json` at the repo root instead.

---

## Telemetry

**Off by default.** Sverklo makes zero network calls unless you explicitly run `sverklo telemetry enable`. If you opt in, we collect only anonymous usage metrics (no code, no queries, no file paths). Full schema and implementation details in [`TELEMETRY.md`](./TELEMETRY.md).

---

## Open Source, Open Core

The full MCP server is **free and open source** (MIT). All 37 tools, no limits, no telemetry, no "free tier" — that's not where the line is.

**Sverklo Pro** (later this year) adds smart auto-capture of decisions, cross-project pattern learning, and larger embedding models. **Sverklo Team** adds shared team memory and on-prem deployment.

The open-core line: **Pro adds new things, never gates current things.** Anything in the OSS server today stays in the OSS server forever.

---

## Links

- [Website](https://sverklo.com)
- [npm](https://www.npmjs.com/package/sverklo)
- [Issues](https://github.com/sverklo/sverklo/issues)
- [First Run Guide](FIRST_RUN.md)
- [Benchmarks](BENCHMARKS.md)
- [Paper (Zenodo, CC BY 4.0)](https://doi.org/10.5281/zenodo.19802051)

## Citing Sverklo

If you use Sverklo or its benchmarks (`bench:primitives`, `bench:swe`) in research, please cite:

> Groshin, N. (2026). *Sverklo: A Local-First Code Intelligence MCP Server and a Cross-Repository Software Engineering Benchmark*. Zenodo. https://doi.org/10.5281/zenodo.19802051

BibTeX:

```bibtex
@misc{groshin2026sverklo,
  author    = {Groshin, Nikita},
  title     = {{Sverklo}: A Local-First Code Intelligence {MCP} Server and a Cross-Repository Software Engineering Benchmark},
  year      = {2026},
  publisher = {Zenodo},
  doi       = {10.5281/zenodo.19802051},
  url       = {https://doi.org/10.5281/zenodo.19802051}
}
```

## Star history

<a href="https://www.star-history.com/#sverklo/sverklo&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=sverklo/sverklo&type=date&theme=dark&legend=top-left" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=sverklo/sverklo&type=date&legend=top-left" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=sverklo/sverklo&type=date&legend=top-left" />
  </picture>
</a>

If sverklo saved your AI from inventing function names that don't exist in your codebase, the most useful thing you can do is **⭐ star this repo** and share with one teammate.

## License

MIT

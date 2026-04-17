---
name: Sverklo Code Intelligence
description: Gives you deep codebase understanding — semantic search, blast-radius analysis, PR review, and health audits
version: 0.8.1
---

# Sverklo Code Intelligence Skill

Sverklo is a local-first code intelligence MCP server. It gives you a dependency graph, semantic search, blast-radius analysis, and risk-scored PR review — all running on the user's machine. No API keys, no cloud, no data leaves the laptop.

## Setup (one time per project)

```bash
npm install -g sverklo
cd /path/to/project
sverklo init
```

`sverklo init` auto-detects the user's AI editor (Claude Code, Cursor, Windsurf, etc.), writes the MCP config, appends sverklo instructions to CLAUDE.md, and verifies the setup. Safe to re-run.

If something looks wrong after setup:
```bash
sverklo doctor
```

Once installed, sverklo tools appear as MCP tools prefixed with `sverklo_`. The index builds automatically on first use.

## When to use Sverklo vs Grep vs Read

**Use Sverklo when:**
- You don't know exactly what to search for ("where is auth handled?")
- You need to understand importance or ranking ("what are the key files?")
- You need blast-radius analysis ("what breaks if I rename this?")
- You need to prove code is dead ("is this function actually called?")
- You're reviewing a diff and need risk scoring

**Use Grep when:**
- You need exact string matching ("does `FEATURE_FLAG_X` exist?")
- You know the literal identifier and just want its location

**Use Read when:**
- You need to see file contents (sverklo is not a file reader)

**Skip sverklo for codebases under ~50 source files** — the overhead doesn't pay off. Just read everything directly.

## Tools Reference

### 1. sverklo_search — Semantic code search

Hybrid BM25 + vector + PageRank search. Use instead of Grep when you don't know the exact string.

```
sverklo_search query:"authentication middleware" top_k:5
```

Returns ranked code chunks with file paths, line numbers, and relevance scores. Results are ordered by structural importance (PageRank), not just text similarity.

**When to reach for it:** "Where is X handled?", "Find the code that does Y", any exploratory search where you'd otherwise grep for 10 different terms.

### 2. sverklo_impact — Blast-radius analysis

Walk the symbol graph and return all transitive callers, ranked by depth.

```
sverklo_impact symbol:"UserService.validate"
```

Returns every function and file that depends on the symbol, how deep the dependency chain goes, and a risk ranking. Essential before any rename, move, or signature change.

**When to reach for it:** Before refactoring, renaming, or deleting anything. "What breaks if I change this?"

### 3. sverklo_review_diff — Risk-scored PR review

Analyzes the current `git diff` and scores each changed file by risk: touched-symbol importance x test coverage x churn history.

```
sverklo_review_diff
```

Returns files sorted by risk, flags production changes with no corresponding test changes, identifies dangling references, and suggests what to read first.

**When to reach for it:** Reviewing any PR or diff. "What should I look at first?", "Are there untested changes?"

### 4. sverklo_audit — Codebase health scoring

One-call structural analysis that surfaces god classes, hub files, dead code candidates, and complexity hotspots.

```
sverklo_audit
```

Returns a health report with specific files and symbols flagged, grouped by issue type.

**When to reach for it:** Onboarding to a new codebase, planning a refactor, or answering "what's the scariest part of this repo?"

### 5. sverklo_remember / sverklo_recall — Persistent memory

Save decisions, patterns, and invariants pinned to the current git SHA. Recall them later with semantic search and staleness detection.

```
sverklo_remember content:"We use Postgres advisory locks instead of Redis for cross-worker mutexes — operational familiarity."
```

```
sverklo_recall query:"rate limiting strategy"
```

Memories survive across sessions. Stale memories (where the referenced code has changed) are flagged automatically.

**When to reach for it:** Recording architectural decisions, checking what was decided before, any context that should persist across coding sessions.

## Other Useful Tools

These are available once sverklo is connected:

| Tool | Use for |
|------|---------|
| `sverklo_overview` | PageRank-ranked codebase map — the most important files, not the biggest |
| `sverklo_lookup` | Find any function/class/type by name (typo-tolerant) |
| `sverklo_refs` | All references to a symbol — proves dead code with certainty |
| `sverklo_deps` | File dependency graph, both directions |
| `sverklo_context` | One-call onboarding: overview + code + saved memories |
| `sverklo_test_map` | Which tests cover which changed symbols |
| `sverklo_diff_search` | Semantic search restricted to the changed surface of a diff |
| `sverklo_ast_grep` | Structural pattern matching across the AST |
| `sverklo_memories` | List all saved memories with health metrics |
| `sverklo_status` | Index health check |

## Example Workflows

### Onboarding to a new codebase
1. `sverklo_context` — get the project overview, saved memories, and codebase map
2. `sverklo_overview` — see the most important files ranked by PageRank
3. `sverklo_audit` — identify god nodes, hub files, and dead code

### Reviewing a PR
1. `sverklo_review_diff` — get risk-scored file analysis and dangling references
2. `sverklo_impact` on any high-risk symbols — see the full blast radius
3. `sverklo_test_map` — check which tests cover the changed code

### Planning a safe refactor
1. `sverklo_impact` on the symbol — see all callers and the blast radius
2. `sverklo_refs` — find every reference with exact matching
3. `sverklo_deps` on the file — understand its dependency context
4. `sverklo_test_map` — identify which tests need updating

### Example prompts that trigger sverklo tools

- "Find everything that would break if I rename `UserRepository.findActive`."
- "Is `parseFoo` actually used anywhere, or can I delete it?"
- "What are the top 10 most important files in this codebase?"
- "Review the current diff. What should I read first?"
- "I'm onboarding — give me a 5-minute mental model of this repo."
- "Save a decision: we chose X over Y because Z."
- "What did we decide about rate limiting? Check memories first."

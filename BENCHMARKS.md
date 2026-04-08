# Performance Benchmarks

Real measurements on real codebases. Reproducible — the harness is at [`scripts/perf-benchmark.mjs`](./scripts/perf-benchmark.mjs).

**Run:** 2026-04-08
**Sverklo version:** v0.2.11
**Hardware:** Apple Silicon laptop, Node 25, sverklo running with `--expose-gc`
**Embedding model:** all-MiniLM-L6-v2 (ONNX, local, 90 MB on disk)

---

## Summary

Five real codebases of increasing size, three languages (Go, TS/JS, Python), one laptop.

| Repo | Files | Chunks | Languages | Cold index | DB on disk | Search p50 | Search p95 | Overview | Impact analysis |
|---|---:|---:|---|---:|---:|---:|---:|---:|---:|
| **[gin-gonic/gin](https://github.com/gin-gonic/gin)** | 99 | 1,413 | Go | 10.3 s | 4.2 MB | 11 ms | 12 ms | 4 ms | 0.75 ms |
| **[microsoft/TypeScript/src](https://github.com/microsoft/TypeScript)** | 707 | 10,873 | TS | 71.1 s | 47 MB | 20 ms | 35 ms | 47 ms | 2.44 ms |
| **[nestjs/nest](https://github.com/nestjs/nest)** | 1,709 | 2,976 | TS/JS | 22.4 s | 11 MB | 14 ms | 14 ms | 16 ms | 0.88 ms |
| **[django/django](https://github.com/django/django)** | 2,942 | 10,900 | Python/JS | 67.9 s | 56 MB | 20 ms | 22 ms | 106 ms | 2.0 ms |
| **[facebook/react](https://github.com/facebook/react)** | 4,368 | 20,144 | TS/JS | 152 s | 67 MB | 23 ms | 26 ms | 58 ms | 1.18 ms |

**The honest read:**
- **Search is fast and stays fast.** Across all five repos, p95 search latency stays between 12 ms (gin) and 35 ms (TypeScript). The TypeScript number is the worst case in the benchmark and it's still well inside any latency budget the agent's hot loop cares about.
- **Impact analysis is 0.75–2.44 ms on every project.** Even on the densest codebase (TypeScript compiler) and the most-called symbol (`isIdentifier`, called from every parser code path), it's an indexed SQL join, not a 200-grep-match scan.
- **Cold-start indexing is linear in chunks, not files.** Across the five runs the constant factor is 6–7 ms per chunk, regardless of language: gin 7.3 ms/chunk, TypeScript 6.5 ms/chunk, nestjs 7.5 ms/chunk, django 6.2 ms/chunk, react 7.5 ms/chunk. A 20 k chunk repo takes ~2.5 minutes the first time. Incremental refresh after that only re-processes files that changed.
- **Steady-state RAM after indexing is much lower than peak.** The peak RSS during indexing is 400–700 MB because the ONNX embedder is loaded and chunks are being batched in memory. Once indexing finishes and the embedder is no longer batching, RSS drops back to ~200 MB. The README's "~200 MB" figure is the steady state, not the indexing peak — BENCHMARKS.md is explicit about that distinction.
- **Languages don't change the shape.** Indexing Python (django) costs about the same per chunk as indexing TypeScript (TypeScript compiler) or Go (gin). Tree-sitter is doing the heavy lifting and it's roughly language-agnostic.

---

## What we measured

For each repo:

1. **Cold index**: delete any existing index DB, instantiate a fresh `Indexer`, time `index()` end-to-end (parse → chunk → embed → graph → PageRank).
2. **RSS**: peak resident set size during the run, captured via `process.memoryUsage().rss`.
3. **DB size on disk**: size of the SQLite file at `~/.sverklo/<project>/index.db` after indexing completes.
4. **Search latency**: 10 representative queries (auth, rate limiter, error handling, websocket, db pool, JSON, validation, logging, fixtures, config). First query dropped as warm-up. p50 and p95 from the remaining 9.
5. **Overview latency**: time to call `sverklo_overview` (PageRank-ranked codebase map).
6. **Impact analysis**: pick the most-referenced symbol in `symbol_refs` (length > 3 chars to skip loop variables), call `sverklo_impact` on it. This is the worst-case for the impact tool — most callers, biggest result set.

---

## Detailed numbers

### gin-gonic/gin (Go, small reference repo)

```
Files indexed:    99
Chunks:           1,413
Languages:        go
Cold index:       10.31 s
RSS peak:         398.6 MB
DB size on disk:  4.2 MB
Search p50:       10.93 ms
Search p95:       11.60 ms
Overview:         4.10 ms
Impact pivot:     Equal
Impact:           0.75 ms
```

A small Go repo. Cold-index time is dominated by the embedder warm-up (the model loads on first run and the first chunks pay that cost). For a project this size you wouldn't actually need sverklo — grep is fine. Included as the lower-bound case.

### nestjs/nest (TypeScript framework)

```
Files indexed:    1,709
Chunks:           2,976
Languages:        javascript, typescript
Cold index:       22.41 s
RSS peak:         486.6 MB
DB size on disk:  10.9 MB
Search p50:       14.00 ms
Search p95:       14.33 ms
Overview:         16.20 ms
Impact pivot:     constructor
Impact:           0.88 ms
```

A real-world TS framework — the kind of codebase a team would actually use sverklo on. Index time is fine, search latency is well under any user-perceptible threshold, and the index is small enough on disk to keep around forever.

### microsoft/TypeScript (compiler `src/` only — dense TS code)

```
Files indexed:    707
Chunks:           10,873
Languages:        typescript
Cold index:       71.11 s
RSS peak:         564.2 MB
DB size on disk:  44.8 MB
Search p50:       19.69 ms
Search p95:       34.64 ms
Overview:         47.00 ms
Impact pivot:     isIdentifier
Impact:           2.44 ms
```

The TypeScript compiler is the **densest codebase** in the benchmark — 707 files but **10,873 chunks**, ~15 chunks per file. That's because the compiler is built out of large files with many internal functions and classes, each of which becomes its own searchable chunk. Indexing time is dominated by chunks-to-embed, not files-to-parse: 71 s for TypeScript vs 22 s for nestjs even though nestjs has 2.4× more files.

We benchmarked `src/` only because the full `microsoft/TypeScript` repo has ~39,000 files, almost all in the `tests/` corpus (every file in the conformance test suite is a separate `.ts`). Indexing the full repo would take an hour, dominated by code that no real user runs sverklo on.

`isIdentifier` was picked as the impact pivot because it's one of the most-called helpers in the entire compiler — every parser code path and every type checker code path calls it. Sub-3-millisecond impact analysis on the most-referenced symbol in the repo is the strongest argument for the indexed-SQL approach over walking files at query time.

### django/django (large Python framework)

```
Files indexed:    2,942
Chunks:           10,900
Languages:        javascript, python
Cold index:       67.86 s
RSS peak:         697.9 MB
DB size on disk:  56.4 MB
Search p50:       20.07 ms
Search p95:       22.42 ms
Overview:         106.32 ms
Impact pivot:     assertEqual
Impact:           2.00 ms
```

The Python anchor in the benchmark suite. 2.9k files (mostly `.py`, with some JS in the admin static assets) producing 10.9k chunks at ~3.7 chunks per file — looser than TypeScript because Python files tend to be smaller.

The `assertEqual` pivot is interesting: it's the most-called symbol in the repo because every test file extends Django's `TestCase` and calls it. PageRank correctly demotes the test files in the search rankings, but `sverklo_impact assertEqual` still finds them all in 2 ms — exactly what you'd want when you're trying to find every test that asserts equality on a value you're about to refactor.

Overview latency is the highest of the five (106 ms) because Django has a wide module tree — the PageRank computation has more nodes to converge over.

### facebook/react (large TS/JS monorepo)

```
Files indexed:    4,368
Chunks:           20,144
Languages:        javascript, typescript
Cold index:       152.44 s   (2 min 32 s)
RSS peak:         666.8 MB
DB size on disk:  66.7 MB
Search p50:       22.94 ms
Search p95:       25.63 ms
Overview:         58.45 ms
Impact pivot:     render
Impact:           1.18 ms
```

The big test. ~4 k files, ~20 k chunks, ~67 MB index on disk, **2.5 minutes to cold-index**. Subsequent searches stay under 26 ms p95. Impact analysis on `render` (one of the most-called symbols in the entire repo) returns in 1.18 ms because the symbol-ref store is fully indexed.

The cold-index time is the headline trade-off: you pay it once per project, then incremental updates only re-process changed files. For an active developer this is a one-time cost on a Friday afternoon.

---

## What this benchmark does NOT measure

We're being deliberate about what's in scope:

- **Retrieval quality** — whether the top result is the right answer. That's measured separately in [`benchmark/`](./benchmark/) (the MR-review F1 harness against real merge requests).
- **Different hardware** — these numbers are from one Apple Silicon laptop. They'll be slower on intel, faster on a maxed-out M-series.
- **Different embedding models** — all measurements use all-MiniLM-L6-v2 (the default). Sverklo Pro will offer larger models with different latency/quality trade-offs.
- **Concurrent indexing of multiple projects** — single project at a time, to keep RSS clean and the timings comparable.
- **First-run model download** — the ~90 MB ONNX model download happens before the timer starts. It only happens once per machine across all projects.

---

## Reproducing

```bash
# 1. Clone sverklo and the target repos
git clone https://github.com/sverklo/sverklo.git
git clone --depth=1 https://github.com/gin-gonic/gin.git /tmp/gin
git clone --depth=1 https://github.com/nestjs/nest.git /tmp/nest
git clone --depth=1 https://github.com/facebook/react.git /tmp/react

# 2. Build sverklo
cd sverklo && npm install && npm run build

# 3. Run the harness
node --expose-gc scripts/perf-benchmark.mjs /tmp/gin /tmp/nest /tmp/react
```

The harness deletes any existing index DB before each run, so re-running is honest about cold-start cost. Times will vary by ~10–20% between runs depending on disk cache state and other system load.

If you run this on a different repo and the numbers diverge from your expectations, [open an issue](https://github.com/sverklo/sverklo/issues) — retrieval quality and indexing performance are the two metrics we most care about.

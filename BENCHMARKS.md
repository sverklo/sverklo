# Performance Benchmarks

Real measurements on real codebases. Reproducible — the harness is at [`scripts/perf-benchmark.mjs`](./scripts/perf-benchmark.mjs).

**Run:** 2026-04-08
**Sverklo version:** v0.2.11
**Hardware:** Apple Silicon laptop, Node 25, sverklo running with `--expose-gc`
**Embedding model:** all-MiniLM-L6-v2 (ONNX, local, 90 MB on disk)

---

## Summary

| Repo | Files | Chunks | Languages | Cold index | DB on disk | Search p50 | Search p95 | Overview | Impact analysis |
|---|---:|---:|---|---:|---:|---:|---:|---:|---:|
| **[gin-gonic/gin](https://github.com/gin-gonic/gin)** | 99 | 1,413 | Go | 10.3 s | 4.2 MB | 11 ms | 12 ms | 4 ms | 0.75 ms |
| **[nestjs/nest](https://github.com/nestjs/nest)** | 1,709 | 2,976 | TS/JS | 22.4 s | 11 MB | 14 ms | 14 ms | 16 ms | 0.88 ms |
| **[facebook/react](https://github.com/facebook/react)** | 4,368 | 20,144 | TS/JS | 152 s | 67 MB | 23 ms | 26 ms | 58 ms | 1.18 ms |

**The honest read:**
- **Search is fast and stays fast.** Even on a 4,368-file React monorepo, p95 search latency is 26 ms. Sverklo is intended to be called in the agent's hot loop and the latency budget allows it.
- **Impact analysis is sub-millisecond on every project we tested.** Walking the symbol graph is one indexed SQL join, not a 200-grep-match scan.
- **Cold-start indexing scales linearly with chunks.** ~7 ms per chunk on the laptop above. A 20 k chunk repo takes ~2.5 minutes the first time. Incremental refresh after that is much cheaper — only changed files get re-parsed and re-embedded.
- **Steady-state RAM after indexing is much lower than peak.** The peak RSS during indexing is 400–700 MB because the ONNX embedder is loaded and chunks are being batched in memory. Once indexing finishes and the embedder is no longer batching, RSS drops back to ~200 MB. The README's "~200 MB" figure is the steady state, not the indexing peak — we'll be more explicit about that.

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

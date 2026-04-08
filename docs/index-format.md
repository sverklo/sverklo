# Sverklo Index Format

_Status: stable for 0.2.x. Breaking changes will bump the `schema_version` row in the `meta` table and trigger a full rebuild on load._

This document explains how sverklo indexes your code on disk so you can reason about its footprint, extend it, or audit it. If you're just using sverklo, you don't need to read this. If you care whether a 50k-file monorepo will fit on your laptop, or whether the on-disk format is auditable, read on.

## Overview

For each project, sverklo builds a single SQLite database at:

```
~/.sverklo/<project-hash>/index.db
```

One file, no sidecars beyond SQLite's `-wal` and `-shm`. Everything — file metadata, parsed symbols, vector embeddings, the dependency graph, PageRank scores, saved memories, telemetry state — lives in this database. SQLite was chosen over a custom binary format for three reasons:

1. **Auditability.** Any user can open the database with `sqlite3` and see exactly what sverklo knows about their code.
2. **Zero dependencies beyond `better-sqlite3`.** No custom serialization, no bespoke mmap layer, no schema drift between versions of the tool.
3. **Crash safety.** SQLite's WAL mode gives us atomic writes and cheap rollback without us writing a single line of crash-recovery code.

Total DB size scales roughly linearly at ~15 KB per source file on mixed-language repos. A 5k-file monorepo lands around 70 MB; react (4,368 files) comes in at 67 MB. The dominant cost is embeddings (4 bytes × 384 dims × chunks ≈ 1.5 KB per chunk).

## Tables

| Table            | Purpose                                                                 |
|------------------|-------------------------------------------------------------------------|
| `meta`           | Schema version, project metadata, last-full-index timestamp            |
| `files`          | One row per source file: path, lang, mtime, sha, line count, file rank |
| `symbols`        | Parsed symbols (functions, classes, types, methods) with spans         |
| `symbol_refs`    | Edges in the call/reference graph: caller symbol → target name         |
| `chunks`         | Parsed code chunks sized for the embedding model                       |
| `embeddings`     | Dense vectors for each chunk (384-dim float32)                         |
| `fts_chunks`     | SQLite FTS5 virtual table for BM25 over chunk text                     |
| `imports`        | File-level import edges: file → imported path/symbol                   |
| `file_graph`     | Adjacency list used by PageRank over files                             |
| `memories`       | Persistent memory rows with tier, git SHA, staleness flags             |
| `memory_ix`      | FTS5 index over memory content for `sverklo_recall`                    |
| `watchpoints`    | Last-known mtimes used by the file watcher to drive incremental updates |

Full DDL lives in `src/storage/schema.ts`.

## Parsing

Source files are parsed with **tree-sitter** grammars for the 10 supported languages (ts, js, python, go, rust, java, c, cpp, ruby, php). Each parser emits:

- A flat list of symbol definitions with their AST spans
- A list of reference sites (call expressions, type references, imports)
- A list of import statements for building the file-level dependency graph

Tree-sitter was chosen because it's incremental, it's fast enough to run on every file watch event, and it produces structured output that survives partial/malformed code — important because sverklo runs while you're still editing.

Chunking happens at the symbol boundary where possible and falls back to a sliding window (with overlap) for files that don't yield usable symbol spans. The chunker targets ~400 tokens per chunk for the embedding model.

## Embedding

Chunks are embedded with **all-MiniLM-L6-v2** (384 dimensions, int8-quantized) via `onnxruntime-node`. This model was picked for the Pareto tradeoff:

- Small enough to ship in the first-run download (~90 MB)
- Fast enough to embed a full React monorepo in a couple minutes on an M1
- Accurate enough for hybrid retrieval, where the BM25 side picks up exact-match signal

Embeddings are stored in the `embeddings` table as `BLOB` columns holding raw little-endian float32. We don't use a dedicated vector index (no FAISS, no HNSW, no sqlite-vss) because at the scale sverklo runs at, a straight cosine scan over 50k vectors is sub-10ms and the query cost is dominated by BM25 + PageRank lookups anyway. We revisit this calculus when we add a larger embedding model in Pro.

## Hybrid Search

`sverklo_search` runs three subqueries in parallel and fuses them with **Reciprocal Rank Fusion (RRF)**:

1. **BM25** over `fts_chunks` for lexical match — catches exact identifiers and string literals.
2. **Cosine similarity** over `embeddings` for semantic match — catches "authentication middleware" style queries.
3. **PageRank boost** multiplied against both signals so structurally important files float up.

RRF is used instead of weighted sum because it's scale-invariant — BM25 scores are unbounded, cosine scores live in `[-1, 1]`, and normalizing them across queries is fragile. RRF just cares about rank, not magnitude. The k parameter is 60 (the common default from the Cormack et al. paper).

PageRank is computed over the file-level dependency graph: file A → file B edge exists if A imports a symbol defined in B. We use damping factor 0.85 and iterate to convergence (typically <40 iterations on real repos). Scores are normalized to [0, 1] and stored in `files.file_rank`.

## Symbol Graph and Impact Analysis

`sverklo_impact` and `sverklo_refs` walk the symbol-level graph built from `symbol_refs`. Edges are directional: caller → called. We resolve references lazily — at indexing time we store target _names_, and at query time we join against `symbols` to find matching definitions. This lazy resolution means:

- We don't blow up on polymorphism or duck typing (both common in TS, Python, Ruby)
- We trade some false positives (same-name symbols in different files) for correctness on real-world code
- Query time stays predictable (indexed join, no tree walks during indexing)

Impact analysis is a bounded BFS with a configurable depth (default 3), ranked by PageRank of the containing file × symbol fan-in. A single call typically returns in <1 ms on the indexes we've tested — it's an indexed SQL join, not a string scan.

## Memory Layer

Sverklo's memory is bi-temporal: each memory row carries both a **wall-clock timestamp** and the **git SHA** at the moment of save. Memories are also tagged with:

- **Tier** (`core` / `project` / `archived`) — core memories are auto-injected on every session start, project memories are searchable via `sverklo_recall`, archived memories are out of the hot path.
- **Staleness flag** — set at load time when the files mentioned in a memory have changed meaningfully since the memory's SHA. Staleness is advisory, not destructive; stale memories still surface but are flagged.

The memory table is intentionally narrow. We do not store embeddings for memories in the main `embeddings` table; they live in `memory_ix` (FTS5) because memory recall is almost always lexical ("what did we decide about rate limits") rather than semantic.

## Incremental Updates

The file watcher (`chokidar`) emits add/change/unlink events. Each event triggers:

1. **Fast path**: mtime comparison against `watchpoints` — skip if unchanged.
2. **Reparse** the file via tree-sitter.
3. **Upsert** into `files` / `symbols` / `imports` / `chunks`.
4. **Re-embed** only the chunks whose text changed (content-hashed).
5. **Re-rank**: PageRank is recomputed lazily. Small edits don't trigger a full recompute; batched changes (>50 files in a 5s window) do.

Incremental indexing is what makes sverklo usable for daily work — a single-file edit is <10 ms from fs event to updated database.

## Access Patterns and Concurrency

Sverklo opens the database in WAL mode with `synchronous=NORMAL`. This gives us:

- Readers (query tools) never block writers (indexer, memory writes)
- Writers never block readers
- A crash during a write cannot corrupt the database — the worst case is a rollback of the in-flight transaction

Only one sverklo process per project directory should be writing at a time. The MCP server enforces this with a lockfile at `~/.sverklo/<project-hash>/index.lock`. A second invocation on the same project fails fast with a clear error instead of silently corrupting the index.

## On-Disk Layout (real numbers)

Measurements from the gin/nestjs/react benchmarks in `BENCHMARKS.md`:

| Repo               | Files  | Chunks | DB size | Embeddings share | FTS share | Graph share |
|--------------------|-------:|-------:|--------:|-----------------:|----------:|------------:|
| gin-gonic/gin      |     99 |    612 |    4 MB |             58 % |      28 % |         9 % |
| nestjs/nest        |  1,709 |  7,200 |   11 MB |             62 % |      24 % |        10 % |
| facebook/react     |  4,368 | 38,500 |   67 MB |             66 % |      22 % |         9 % |

Embeddings dominate. If you need a smaller footprint and can accept worse semantic recall, set `embeddings.model = "none"` in `.sverklo/config.json` and sverklo falls back to pure BM25 + PageRank.

## Extending

The schema is stable for 0.2.x but additive changes are always safe: add a column, add a table, bump `meta.schema_version`. Destructive changes (dropping columns, renaming tables) trigger a full reindex on the next server start — sverklo compares `meta.schema_version` on load and wipes-and-rebuilds if the running binary expects a newer version than the database was built with.

If you want to build a tool on top of the index, open the database read-only:

```js
import Database from "better-sqlite3";
const db = new Database("~/.sverklo/<project-hash>/index.db", { readonly: true });
const topFiles = db
  .prepare("SELECT path, file_rank FROM files ORDER BY file_rank DESC LIMIT 20")
  .all();
```

No API stability guarantees on the SQL shape yet, but the meta table always knows what version it is. That's enough for defensive consumers.

## Further reading

- `src/storage/schema.ts` — DDL and migration logic
- `src/search/hybrid.ts` — RRF fusion and PageRank boost
- `src/indexer/indexer.ts` — the top-level indexer loop
- `src/memory/store.ts` — the memory layer
- `BENCHMARKS.md` — real numbers on real repos

Have a question we didn't cover? File an issue with `docs:` in the title.

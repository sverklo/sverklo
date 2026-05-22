import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import type { Database } from "../storage/database.js";
import {
  createDatabase,
  getDataVersion,
  setDataVersion,
  transaction,
  CURRENT_DATA_VERSION,
} from "../storage/database.js";
import { FileStore } from "../storage/file-store.js";
import { ChunkStore } from "../storage/chunk-store.js";
import { EmbeddingStore } from "../storage/embedding-store.js";
import { GraphStore } from "../storage/graph-store.js";
import { MemoryStore } from "../storage/memory-store.js";
import { MemoryEmbeddingStore } from "../storage/memory-embedding-store.js";
import { SymbolRefStore } from "../storage/symbol-ref-store.js";
import { DocEdgeStore } from "../storage/doc-edge-store.js";
import { EvidenceStore } from "../storage/evidence-store.js";
import { ConceptStore } from "../storage/concept-store.js";
import { HandleStore } from "../storage/handle-store.js";
import { PatternStore } from "../storage/pattern-store.js";
import { MemoryJournal } from "../memory/journal.js";
import { discoverFiles } from "./file-discovery.js";
import { parseFile } from "./parser.js";
import { describeChunk } from "./describer.js";
import { embed as legacyEmbed, initEmbedder } from "./embedder.js";
import {
  createEmbeddingProvider,
  type EmbeddingProvider,
} from "./embedding-providers.js";
import { buildGraph } from "./graph-builder.js";
import { buildDocLinks } from "./doc-linker.js";
import { extractReferences } from "./symbol-extractor.js";
import { createIgnoreFilter } from "../utils/ignore.js";
import { estimateTokens } from "../utils/tokens.js";
import { log, logError, logSummary, logTiming } from "../utils/logger.js";
import { loadSverkloConfig, type SverkloConfig } from "../utils/config-file.js";
import { track } from "../telemetry/index.js";
import type { ProjectConfig, ImportRef, IndexStatus } from "../types/index.js";
import type { IndexFiles } from "./index-files.js";
import type { IndexCode } from "./index-code.js";
import type { IndexGraph } from "./index-graph.js";
import type { IndexMemory } from "./index-memory.js";
import type { IndexAdmin } from "./index-admin.js";

export class Indexer implements IndexFiles, IndexCode, IndexGraph, IndexMemory, IndexAdmin {
  private db: Database;
  public fileStore: FileStore;
  public chunkStore: ChunkStore;
  public embeddingStore: EmbeddingStore;
  public graphStore: GraphStore;
  public memoryStore: MemoryStore;
  public memoryEmbeddingStore: MemoryEmbeddingStore;
  public symbolRefStore: SymbolRefStore;
  public docEdgeStore: DocEdgeStore;
  public evidenceStore: EvidenceStore;
  public conceptStore: ConceptStore;
  public handleStore: HandleStore;
  public patternStore: PatternStore;
  public memoryJournal: MemoryJournal;

  // Issue #9 wiring (caught during dogfood session, 2026-04-08):
  // The pluggable provider factory existed but the indexer was still
  // calling the bundled ONNX embed() directly, so SVERKLO_EMBEDDING_PROVIDER
  // had no effect. We lazily select a provider on the first index() call,
  // then use it everywhere via the public embed() method below.
  private embeddingProvider: EmbeddingProvider | null = null;
  public sverkloConfig: SverkloConfig | null = null;
  private indexing = false;
  private progress = { done: 0, total: 0 };
  private lastIndexedTime: number | null = null;

  // Freshness result cache. The disk walk in getFreshness() dominates the
  // cost of sverklo_status (~95ms on a 150-file repo before this cache was
  // added — see issue #6). Status is a read-only advisory call and the
  // filesystem doesn't meaningfully change in a 2-second window, so we
  // memoize briefly. The file watcher invalidates on real changes below.
  private freshnessCache: {
    ts: number;
    result: { ageSeconds: number | null; dirtyFiles: string[]; missingFiles: string[] };
  } | null = null;
  private static readonly FRESHNESS_CACHE_MS = 2000;

  constructor(private config: ProjectConfig) {
    this.db = createDatabase(config.dbPath);
    this.fileStore = new FileStore(this.db);
    this.chunkStore = new ChunkStore(this.db);
    this.embeddingStore = new EmbeddingStore(this.db);
    this.graphStore = new GraphStore(this.db);
    this.memoryStore = new MemoryStore(this.db);
    this.memoryEmbeddingStore = new MemoryEmbeddingStore(this.db);
    this.symbolRefStore = new SymbolRefStore(this.db);
    this.docEdgeStore = new DocEdgeStore(this.db);
    this.evidenceStore = new EvidenceStore(this.db);
    // Purge stale evidence rows on startup (cheap; bounded by LRU cap).
    try { this.evidenceStore.purge(); } catch { /* pre-v4 db without evidence table */ }
    this.conceptStore = new ConceptStore(this.db);
    this.handleStore = new HandleStore(this.db);
    try { this.handleStore.purgeExpired(); } catch { /* pre-v6 db without context_handles */ }
    this.patternStore = new PatternStore(this.db);
    this.memoryJournal = new MemoryJournal(config.rootPath);

    // Load .sverklo.yaml config if present
    this.sverkloConfig = loadSverkloConfig(config.rootPath);

    // Run any outstanding data migrations before any query code touches
    // the stores. Migrations are surgical — they operate on the existing
    // data and never require a full reindex — so the user sees zero
    // downtime on upgrade.
    this.runDataMigrations();
  }

  /**
   * Bring the on-disk data layer up to CURRENT_DATA_VERSION. Runs
   * once on Indexer construction and is a no-op on already-current
   * databases.
   *
   * Migrations are intentionally side-effecting on this instance's
   * stores; each one should be small, deterministic, and fast.
   */
  private runDataMigrations(): void {
    const stored = getDataVersion(this.db);
    if (stored >= CURRENT_DATA_VERSION) return;

    // A fresh database has version 0 and no data yet — we'll stamp it
    // below without running any migrations. Only existing data needs
    // upgrading.
    const chunkCount = this.chunkStore.count();

    if (stored < 2 && chunkCount > 0) {
      // Migration 1 → 2: re-extract symbol references from every
      // existing chunk. Fixes github.com/sverklo/sverklo/issues/13
      // where v0.2.13 and earlier collapsed repeat calls of the
      // same symbol in one chunk to a single symbol_refs row.
      //
      // We drop the old symbol_refs rows and re-run extractReferences
      // in-process. No file I/O, no re-parsing — just regex over the
      // chunk bodies we already have in the DB.
      log(
        `[migration] data_version ${stored} → 2: re-extracting symbol refs for ${chunkCount} chunks (fixes #13)`
      );
      const t0 = Date.now();
      this.db.exec("DELETE FROM symbol_refs");

      // Pull chunks one at a time to keep memory bounded on huge repos.
      const rows = this.db
        .prepare("SELECT id, name, start_line, content FROM chunks")
        .all() as { id: number; name: string | null; start_line: number; content: string }[];

      let totalRefs = 0;
      transaction(this.db, () => {
        for (const row of rows) {
          const refs = extractReferences(row.content, row.name);
          for (const ref of refs) {
            this.symbolRefStore.insert(
              row.id,
              ref.name,
              row.start_line + ref.line
            );
            totalRefs++;
          }
        }
      });

      log(
        `[migration] extracted ${totalRefs} symbol refs in ${Date.now() - t0}ms`
      );
    }

    if (stored < 8) {
      // Migration 7 → 8: backfill `memories.kind` from `category` so the
      // dashboard's semantic/procedural filter chips aren't empty on
      // upgraded databases. Mirrors `defaultKindFor` in memory-store.ts.
      // One-time pass gated on data_version so explicit kinds set by
      // `sverklo_remember` after the upgrade are preserved.
      this.db.exec(
        "UPDATE memories SET kind = 'procedural' " +
        "WHERE kind = 'episodic' AND category = 'procedural'"
      );
      this.db.exec(
        "UPDATE memories SET kind = 'semantic' " +
        "WHERE kind = 'episodic' AND category IN ('preference', 'pattern')"
      );
    }

    if (stored < 10 && chunkCount > 0) {
      // Migration 8/9 → 10: repair the dependency graph. Pre-9 FileStore
      // used INSERT OR REPLACE, which silently cascade-deleted every
      // dependency row involving a re-indexed file (both as source and
      // target). buildGraph only restored outgoing edges, so over time
      // every file accumulated phantom-missing incoming edges from
      // cached sources. Symptom: sv-p4-04 (chunk-store.ts importers)
      // returned 0 when 3 files actually imported it.
      //
      // Repair: drop the corrupted `dependencies` table and force a
      // re-parse of every file under the corrected upsert. The toIndex
      // filter in index() compares `last_modified` (mtime), so we have
      // to reset that too — v9 only cleared `hash` and the rebuild
      // never fired because mtime still matched on-disk values.
      log(
        `[migration] data_version ${stored} → 10: clearing corrupted dependency graph (sv-p4-04 fix); next index will re-parse all files`
      );
      this.db.exec("DELETE FROM dependencies");
      this.db.exec("UPDATE files SET hash = '', last_modified = 0");
      // Direct bulk SQL bypasses FileStore.upsert/delete/updatePagerank,
      // so the in-memory getAll snapshot cache wouldn't auto-invalidate
      // here. Explicit drop so the next getAll() reflects the migration.
      this.fileStore.invalidateCache();
    }

    setDataVersion(this.db, CURRENT_DATA_VERSION);
  }

  get rootPath(): string {
    return this.config.rootPath;
  }

  /**
   * Embed a batch of texts using the selected provider. Callers should
   * prefer this over importing the legacy embed() directly so that a
   * single env-var change (SVERKLO_EMBEDDING_PROVIDER) actually takes
   * effect across every query path.
   *
   * If the provider hasn't been lazily initialized yet (embed() called
   * before the first index() run), we init the default provider
   * synchronously via the bundled ONNX module so read-path tools like
   * search / recall / remember still work during bootstrap.
   */
  // Process-level query cache. Single-element queries get cached so a
  // chained `sverklo_search` → `sverklo_investigate` → `sverklo_ask` on
  // the same query embeds once instead of three times. Bounded LRU; the
  // ONNX embedding takes ~30-60 ms for a single string, so a cache hit
  // saves a meaningful chunk of the chained-call latency.
  //
  // Cache key includes the active provider name so a mid-process
  // SVERKLO_EMBEDDING_PROVIDER switch (or lazy init landing on a
  // different default than the bootstrap legacyEmbed) doesn't serve
  // dimension-incompatible vectors.
  private __embedCache = new Map<string, Float32Array>();
  private static __embedCacheMax = 64;

  async embed(texts: string[]): Promise<Float32Array[]> {
    // Fast path: only the single-text query path is cacheable. Multi-
    // text batches are index-time bulk work and would just thrash the
    // cache. Use the cache; otherwise fall through to the provider.
    if (texts.length === 1) {
      const providerName = this.embeddingProvider?.name ?? "default";
      const key = `${providerName}\x00${texts[0]}`;
      const hit = this.__embedCache.get(key);
      if (hit !== undefined) {
        // LRU touch: re-insert so this key becomes most-recent.
        this.__embedCache.delete(key);
        this.__embedCache.set(key, hit);
        return [hit];
      }

      const vec = this.embeddingProvider
        ? (await this.embeddingProvider.embed(texts))[0]
        : (await this.initLegacyAndEmbed(texts))[0];

      this.__embedCache.set(key, vec);
      if (this.__embedCache.size > Indexer.__embedCacheMax) {
        // Evict the least-recently-used key (first in insertion order).
        const oldest = this.__embedCache.keys().next().value;
        if (oldest !== undefined) this.__embedCache.delete(oldest);
      }
      return [vec];
    }

    if (this.embeddingProvider) {
      return this.embeddingProvider.embed(texts);
    }
    return this.initLegacyAndEmbed(texts);
  }

  // Bootstrap the legacy embedder if the provider hasn't lazily
  // initialized yet. Extracted so both the cached and uncached paths
  // share the same init.
  private async initLegacyAndEmbed(texts: string[]): Promise<Float32Array[]> {
    await initEmbedder();
    return legacyEmbed(texts);
  }

  /**
   * Human-readable name of the active embedding provider. Used by
   * sverklo_status and sverklo doctor to show the user which provider
   * their env vars actually selected. Returns "default" if the
   * provider hasn't been initialized yet.
   */
  get embeddingProviderName(): string {
    return this.embeddingProvider?.name ?? "default";
  }

  /**
   * Dimensions of the active embedding provider. Surfaced in status
   * so users can spot a dimension mismatch that would require reindex.
   */
  get embeddingDimensions(): number {
    return this.embeddingProvider?.dimensions ?? 384;
  }

  async index(): Promise<void> {
    if (this.indexing) return;
    this.indexing = true;

    // Cold-start vs refresh detection: cold start = no file records yet.
    // Computed before provider init so we don't count model download in duration.
    const __isColdStart = this.fileStore.count() === 0;

    try {
      log(`Indexing ${this.config.rootPath}...`);
      const startTime = Date.now();
      // Phase-timing instrumentation, gated on SVERKLO_TIMING=1.
      // Without this, the only feedback from `sverklo reindex` is one
      // wall-clock number; you can't tell whether 17s on a small repo
      // is dominated by model load, parsing, embedding, or graph build.
      // Dogfood perf review 2026-05-14 (Issue I3).
      const timingEnabled = process.env.SVERKLO_TIMING === "1";
      const phaseTimes: Record<string, number> = {};
      const phaseStart = (): number => Date.now();
      const phaseEnd = (label: string, t0: number): void => {
        if (timingEnabled) {
          phaseTimes[label] = Date.now() - t0;
          logTiming(`${label}: ${phaseTimes[label]}ms`);
        }
      };
      const tProviderInit = phaseStart();

      // Select the embedding provider lazily on first index. Reads
      // .sverklo.yaml `embeddings.*` first, then SVERKLO_EMBEDDING_PROVIDER
      // + related env vars, then falls back to the bundled ONNX model on
      // any failure. Only runs once per Indexer instance — subsequent
      // index() calls reuse it.
      //
      // Bug fix (#59, v0.25.0): this used to call createEmbeddingProvider()
      // with no arguments, which made `.sverklo.yaml` `embeddings.provider`
      // a silent no-op. Users configuring Ollama / a custom ONNX model
      // through the YAML got the bundled 384-dim MiniLM and didn't know.
      if (!this.embeddingProvider) {
        this.embeddingProvider = await createEmbeddingProvider(
          process.env,
          this.sverkloConfig,
        );
      }
      phaseEnd("provider_init", tProviderInit);

      // 1. Discover files
      const tDiscover = phaseStart();
      const ignoreFilter = createIgnoreFilter(this.config.rootPath);
      const files = discoverFiles(this.config.rootPath, ignoreFilter);
      this.progress = { done: 0, total: files.length };
      log(`Discovered ${files.length} files`);
      phaseEnd("discover", tDiscover);

      // 2. Determine which files need (re)indexing
      // Use mtime for fast change detection (avoid reading file content twice)
      const toIndex = files.filter((f) => {
        const existing = this.fileStore.getByPath(f.relativePath);
        if (!existing) return true;
        return existing.last_modified !== f.lastModified;
      });

      // 3. Remove files that no longer exist
      const currentPaths = new Set(files.map((f) => f.relativePath));
      for (const existing of this.fileStore.getAll()) {
        if (!currentPaths.has(existing.path)) {
          this.fileStore.delete(existing.path);
          log(`Removed deleted file: ${existing.path}`);
        }
      }

      if (toIndex.length === 0) {
        log("Index is up to date");
        this.indexing = false;
        // Emit a refresh event for the no-op case so we can see how often
        // people re-run sverklo on already-indexed projects.
        if (!__isColdStart) void track("index.refresh", { duration_ms: 0 });
        return;
      }

      log(`Indexing ${toIndex.length} files (${files.length - toIndex.length} cached)`);

      // 4. Parse, chunk, describe, embed
      const tParseInsert = phaseStart();
      const fileImports = new Map<string, ImportRef[]>();
      const BATCH_SIZE = 32;
      const embeddingBatch: { chunkId: number; text: string }[] = [];

      // Use a transaction for bulk inserts
      transaction(this.db, () => {
        for (const file of toIndex) {
          try {
            const content = readFileSync(file.absolutePath, "utf-8");
            const contentHash = createHash("sha256").update(content).digest("hex").slice(0, 16);

            // Upsert file record
            const fileId = this.fileStore.upsert(
              file.relativePath,
              file.language,
              contentHash,
              file.lastModified,
              file.sizeBytes
            );

            // Clear old chunks for this file
            this.chunkStore.deleteByFile(fileId);

            // Parse
            const result = parseFile(content, file.language);
            fileImports.set(file.relativePath, result.imports);

            // Store chunks
            for (const chunk of result.chunks) {
              const description = describeChunk(
                chunk,
                file.relativePath,
                file.language
              );
              const tokenCount = estimateTokens(chunk.content);

              const chunkId = this.chunkStore.insert(
                fileId,
                chunk.type,
                chunk.name,
                chunk.signature,
                chunk.startLine,
                chunk.endLine,
                chunk.content,
                description,
                tokenCount
              );

              // Extract symbol references (calls + constructors) for impact analysis
              const refs = extractReferences(chunk.content, chunk.name);
              for (const ref of refs) {
                this.symbolRefStore.insert(
                  chunkId,
                  ref.name,
                  chunk.startLine + ref.line
                );
              }

              // Queue for embedding
              const embText =
                description + "\n" + chunk.content.slice(0, 512);
              embeddingBatch.push({ chunkId, text: embText });
            }

            this.progress.done++;
          } catch (err) {
            logError(`Failed to index ${file.relativePath}`, err);
            this.progress.done++;
          }
        }
      });
      phaseEnd("parse_chunk_insert", tParseInsert);

      // 5. Generate embeddings in batches
      const tEmbed = phaseStart();
      log(`Generating embeddings for ${embeddingBatch.length} chunks...`);
      for (let i = 0; i < embeddingBatch.length; i += BATCH_SIZE) {
        const batch = embeddingBatch.slice(i, i + BATCH_SIZE);
        const texts = batch.map((b) => b.text);
        const vectors = await this.embed(texts);

        for (let j = 0; j < batch.length; j++) {
          this.embeddingStore.insert(batch[j].chunkId, vectors[j]);
        }
      }
      phaseEnd("embed", tEmbed);

      // 6. FTS sync is maintained by chunks_ai/chunks_ad/chunks_au
      // triggers on every chunk INSERT/UPDATE/DELETE (see database.ts:127-142).
      // The historical `INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild')`
      // call here indexed every chunk a SECOND time on cold-start because
      // the triggers had already populated FTS. Architectural review
      // 2026-05-13 (P5 in the Performance synthesis) flagged this as
      // 10-25% of cold-start work, free to recover. If a future
      // migration ever needs to force a full FTS rebuild, exec the
      // rebuild statement explicitly from that migration — not here.

      // 7. Build dependency graph and compute PageRank
      const tGraph = phaseStart();
      log("Building dependency graph...");
      buildGraph(fileImports, this.fileStore, this.graphStore, this.config.rootPath);
      phaseEnd("graph_pagerank", tGraph);

      // 7b. Link doc chunks → symbols (v0.13, P0-5). Requires graph build
      // first so we walk top-PageRank files for the "known symbols" gate.
      const tDocLink = phaseStart();
      try {
        const allFiles = this.fileStore.getAll(); // sorted by pagerank DESC
        const docChunks: import("../types/index.js").CodeChunk[] = [];
        for (const f of allFiles) {
          if (f.language !== "markdown") continue;
          for (const c of this.chunkStore.getByFile(f.id)) {
            if (c.type === "doc_section" || c.type === "doc_code") docChunks.push(c);
          }
        }
        if (docChunks.length > 0) {
          const r = buildDocLinks(this.chunkStore, this.docEdgeStore, docChunks);
          log(
            `Doc links: ${r.docChunksProcessed} doc chunks → ${r.mentionsCreated} mentions ` +
              `(${r.resolvedCount} resolved to symbols)`
          );
        }
      } catch (err) {
        logError("doc-linking failed (non-fatal)", err);
      }
      phaseEnd("doc_link", tDocLink);

      // 8. Update project metadata
      this.lastIndexedTime = Date.now();
      // Any full reindex invalidates the freshness cache: the disk
      // walk we cached is stale relative to the new index state.
      // Skipping this left sverklo_status showing the old dirty list
      // for up to FRESHNESS_CACHE_MS after a forced rebuild.
      this.freshnessCache = null;
      const elapsed = this.lastIndexedTime - startTime;
      // Always-on summary so users see total time on every indexing
      // flow (audit, index, reindex) without needing SVERKLO_DEBUG=1.
      // Issue #54.
      logSummary(
        `Indexing complete: ${this.fileStore.count()} files, ` +
          `${this.chunkStore.count()} chunks in ${elapsed}ms`
      );
      if (timingEnabled) {
        const summary = Object.entries(phaseTimes)
          .map(([k, v]) => `${k}=${v}ms`)
          .join(" · ");
        logTiming(`summary: ${summary} · total=${elapsed}ms`);
      }

      // Telemetry: cold-start measures time-to-first-search for new projects;
      // refresh measures incremental work cost. No file/chunk counts (those
      // can fingerprint a repo).
      if (__isColdStart) {
        void track("index.cold_start", { duration_ms: elapsed });
      } else {
        void track("index.refresh", { duration_ms: elapsed });
      }
    } finally {
      this.indexing = false;
    }
  }

  async reindexFile(relativePath: string, absolutePath: string, language: string): Promise<void> {
    try {
      const content = readFileSync(absolutePath, "utf-8");
      const contentHash = createHash("sha256").update(content).digest("hex").slice(0, 16);
      const { statSync } = await import("node:fs");
      const stat = statSync(absolutePath);

      const fileId = this.fileStore.upsert(
        relativePath,
        language,
        contentHash,
        stat.mtimeMs,
        stat.size
      );

      this.chunkStore.deleteByFile(fileId);

      const result = parseFile(content, language);

      // Rebuild dependency edges for this file
      this.graphStore.deleteBySourceFile(fileId);
      const fileImports = new Map<string, ImportRef[]>();
      fileImports.set(relativePath, result.imports);
      buildGraph(fileImports, this.fileStore, this.graphStore, this.config.rootPath);

      // Two-pass to batch the embedding call. Per-chunk `embed([text])`
      // pays full ONNX session overhead per invocation; on a file with 30+
      // symbols that's 30+ separate runs vs one. The full-index path
      // (index() above) already does this; reindexFile was the laggard.
      // Surfaced by the Performance Benchmarker dogfood pass 2026-05-13.
      const pending: Array<{ chunkId: number; text: string }> = [];
      for (const chunk of result.chunks) {
        const description = describeChunk(chunk, relativePath, language);
        const tokenCount = estimateTokens(chunk.content);
        const chunkId = this.chunkStore.insert(
          fileId,
          chunk.type,
          chunk.name,
          chunk.signature,
          chunk.startLine,
          chunk.endLine,
          chunk.content,
          description,
          tokenCount
        );

        // Extract symbol references for impact analysis
        const refs = extractReferences(chunk.content, chunk.name);
        for (const ref of refs) {
          this.symbolRefStore.insert(
            chunkId,
            ref.name,
            chunk.startLine + ref.line
          );
        }

        pending.push({
          chunkId,
          text: description + "\n" + chunk.content.slice(0, 512),
        });
      }

      // Single batched embed call. The embedding provider handles its own
      // internal batching (BATCH=16 in embedder.ts) — passing the whole
      // file's chunks lets it run in one ONNX session call when N ≤ BATCH.
      if (pending.length > 0) {
        const vectors = await this.embed(pending.map((p) => p.text));
        for (let i = 0; i < pending.length; i++) {
          this.embeddingStore.insert(pending[i].chunkId, vectors[i]);
        }
      }
    } catch (err) {
      logError(`Failed to reindex ${relativePath}`, err);
    }
  }

  removeFile(relativePath: string): void {
    this.fileStore.delete(relativePath);
  }

  getStatus(): IndexStatus {
    const chunkCount = this.chunkStore.count();
    const chunksEmbedded = this.embeddingStore.count();
    const coveragePct = chunkCount > 0
      ? Math.round((chunksEmbedded / chunkCount) * 1000) / 10
      : 0;
    // #60 + #59: surface the embedding pipeline state so users can spot
    // dim mismatch or coverage gaps without dropping to SQLite.
    const embeddings = {
      chunksEmbedded,
      coveragePct,
      dimensionsObserved: this.embeddingStore.dimensionsObserved(),
      dimensionsConfigured:
        (this.sverkloConfig?.embeddings?.dimensions as number | undefined) ?? null,
      provider:
        (this.sverkloConfig?.embeddings?.provider as string | undefined) ?? null,
    };
    return {
      projectName: this.config.name,
      rootPath: this.config.rootPath,
      fileCount: this.fileStore.count(),
      chunkCount,
      languages: this.fileStore.getLanguages(),
      lastIndexedAt: this.lastIndexedTime,
      indexing: this.indexing,
      progress: this.indexing ? this.progress : undefined,
      embeddings,
    };
  }

  /**
   * Compute index freshness by walking the filesystem and comparing mtimes
   * to what's stored in the file index. Used by sverklo_status so reviewer
   * agents can decide whether to fall back to grep on a stale index.
   *
   * Disk walk is bounded by the same ignore filter as indexing, and status
   * is a low-frequency call (start of session) so the cost is acceptable.
   */
  getFreshness(): { ageSeconds: number | null; dirtyFiles: string[]; missingFiles: string[] } {
    // Serve from cache if recent. Issue #6 — this call dominated the
    // wall-clock cost of sverklo_status, which agents can hit multiple
    // times per session.
    if (
      this.freshnessCache &&
      Date.now() - this.freshnessCache.ts < Indexer.FRESHNESS_CACHE_MS
    ) {
      // Refresh ageSeconds (wall-clock keeps moving) but reuse the
      // expensive disk-walk result.
      const ageSeconds =
        this.lastIndexedTime === null
          ? null
          : Math.floor((Date.now() - this.lastIndexedTime) / 1000);
      return { ...this.freshnessCache.result, ageSeconds };
    }

    const ageSeconds =
      this.lastIndexedTime === null
        ? null
        : Math.floor((Date.now() - this.lastIndexedTime) / 1000);

    const dirtyFiles: string[] = [];
    const missingFiles: string[] = [];

    try {
      const ignoreFilter = createIgnoreFilter(this.config.rootPath);
      const onDisk = discoverFiles(this.config.rootPath, ignoreFilter);
      const onDiskMap = new Map(onDisk.map((f) => [f.relativePath, f.lastModified]));

      // Single pass over the indexed file list — the previous version
      // called fileStore.getAll() twice, doubling the SQLite scan cost
      // on large repos.
      const indexedFiles = this.fileStore.getAll();
      const indexedPaths = new Set<string>();
      for (const indexed of indexedFiles) {
        indexedPaths.add(indexed.path);
        const diskMtime = onDiskMap.get(indexed.path);
        if (diskMtime === undefined) {
          missingFiles.push(indexed.path);
        } else if (diskMtime !== indexed.last_modified) {
          dirtyFiles.push(indexed.path);
        }
      }

      // Files on disk but not in the index (new since last index)
      for (const f of onDisk) {
        if (!indexedPaths.has(f.relativePath)) {
          dirtyFiles.push(f.relativePath);
        }
      }
    } catch (err) {
      logError("getFreshness: disk walk failed", err);
    }

    const result = { ageSeconds, dirtyFiles, missingFiles };
    this.freshnessCache = { ts: Date.now(), result };
    return result;
  }

  /**
   * Drop the freshness cache. Called by the file watcher when a real
   * change event fires so the next sverklo_status reflects reality
   * without waiting for the 2-second TTL.
   */
  invalidateFreshnessCache(): void {
    this.freshnessCache = null;
  }

  close(): void {
    this.db.close();
  }

  /**
   * Delete the index database entirely and reinitialize empty stores.
   * Caller is responsible for triggering a reindex afterwards if desired.
   *
   * Returns the list of files that were deleted plus any that failed
   * (e.g. EBUSY on Windows when another sverklo process holds the
   * SQLite WAL/SHM open). Callers MUST check the `failed` array —
   * issue #58 (2026-05-22) showed reindex --force happily exiting
   * "Done" after every unlink failed and the same stale DB was
   * reopened, leaving users certain they'd tested a fresh index.
   */
  clearIndex(): { deleted: string[]; failed: Array<{ path: string; error: NodeJS.ErrnoException }> } {
    // Close existing connection
    try {
      this.db.close();
    } catch {
      // already closed
    }

    // Delete the .db file (and sqlite sidecars if present)
    const dbPath = this.config.dbPath;
    const deleted: string[] = [];
    const failed: Array<{ path: string; error: NodeJS.ErrnoException }> = [];
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      const p = dbPath + suffix;
      if (existsSync(p)) {
        try {
          unlinkSync(p);
          deleted.push(p);
        } catch (err) {
          const e = err as NodeJS.ErrnoException;
          logError(`Failed to delete ${p}`, e);
          failed.push({ path: p, error: e });
        }
      }
    }

    // Reinitialize a fresh database and stores
    this.db = createDatabase(dbPath);
    this.fileStore = new FileStore(this.db);
    this.chunkStore = new ChunkStore(this.db);
    this.embeddingStore = new EmbeddingStore(this.db);
    this.graphStore = new GraphStore(this.db);
    this.memoryStore = new MemoryStore(this.db);
    this.memoryEmbeddingStore = new MemoryEmbeddingStore(this.db);
    this.symbolRefStore = new SymbolRefStore(this.db);
    this.docEdgeStore = new DocEdgeStore(this.db);
    this.evidenceStore = new EvidenceStore(this.db);
    this.conceptStore = new ConceptStore(this.db);
    this.handleStore = new HandleStore(this.db);
    this.patternStore = new PatternStore(this.db);

    // Reset state
    this.indexing = false;
    this.progress = { done: 0, total: 0 };
    this.lastIndexedTime = null;
    this.freshnessCache = null;

    return { deleted, failed };
  }
}

function hashFile(filePath: string): string {
  const content = readFileSync(filePath, "utf-8");
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

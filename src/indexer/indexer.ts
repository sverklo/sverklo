import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import {
  createDatabase,
  getDataVersion,
  setDataVersion,
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
import { log, logError } from "../utils/logger.js";
import { loadSverkloConfig, type SverkloConfig } from "../utils/config-file.js";
import { track } from "../telemetry/index.js";
import type { ProjectConfig, ImportRef, IndexStatus } from "../types/index.js";

export class Indexer {
  private db: Database.Database;
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
      const insertTxn = this.db.transaction(() => {
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
      insertTxn();

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
  private __embedCache = new Map<string, Float32Array>();
  private static __embedCacheMax = 64;

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (this.embeddingProvider) {
      return this.embeddingProvider.embed(texts);
    }
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

      // Select the embedding provider lazily on first index. This
      // reads SVERKLO_EMBEDDING_PROVIDER + related env vars and falls
      // back to the bundled ONNX model on any failure. Only runs once
      // per Indexer instance — subsequent index() calls reuse it.
      if (!this.embeddingProvider) {
        this.embeddingProvider = await createEmbeddingProvider();
      }

      // 1. Discover files
      const ignoreFilter = createIgnoreFilter(this.config.rootPath);
      const files = discoverFiles(this.config.rootPath, ignoreFilter);
      this.progress = { done: 0, total: files.length };
      log(`Discovered ${files.length} files`);

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
      const fileImports = new Map<string, ImportRef[]>();
      const BATCH_SIZE = 32;
      const embeddingBatch: { chunkId: number; text: string }[] = [];

      // Use a transaction for bulk inserts
      const transaction = this.db.transaction(() => {
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

      transaction();

      // 5. Generate embeddings in batches
      log(`Generating embeddings for ${embeddingBatch.length} chunks...`);
      for (let i = 0; i < embeddingBatch.length; i += BATCH_SIZE) {
        const batch = embeddingBatch.slice(i, i + BATCH_SIZE);
        const texts = batch.map((b) => b.text);
        const vectors = await this.embed(texts);

        for (let j = 0; j < batch.length; j++) {
          this.embeddingStore.insert(batch[j].chunkId, vectors[j]);
        }
      }

      // 6. Rebuild FTS index (ensures sync with content table)
      this.db.exec("INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild')");

      // 7. Build dependency graph and compute PageRank
      log("Building dependency graph...");
      buildGraph(fileImports, this.fileStore, this.graphStore, this.config.rootPath);

      // 7b. Link doc chunks → symbols (v0.13, P0-5). Requires graph build
      // first so we walk top-PageRank files for the "known symbols" gate.
      try {
        const allFiles = this.fileStore.getAll(); // sorted by pagerank DESC
        const fileCache = new Map(allFiles.map((f) => [f.id, f] as const));
        const docChunks: import("../types/index.js").CodeChunk[] = [];
        for (const f of allFiles) {
          if (f.language !== "markdown") continue;
          for (const c of this.chunkStore.getByFile(f.id)) {
            if (c.type === "doc_section" || c.type === "doc_code") docChunks.push(c);
          }
        }
        if (docChunks.length > 0) {
          const r = buildDocLinks(this.chunkStore, this.docEdgeStore, fileCache, docChunks);
          log(
            `Doc links: ${r.docChunksProcessed} doc chunks → ${r.mentionsCreated} mentions ` +
              `(${r.resolvedCount} resolved to symbols)`
          );
        }
      } catch (err) {
        logError("doc-linking failed (non-fatal)", err);
      }

      // 8. Update project metadata
      this.lastIndexedTime = Date.now();
      // Any full reindex invalidates the freshness cache: the disk
      // walk we cached is stale relative to the new index state.
      // Skipping this left sverklo_status showing the old dirty list
      // for up to FRESHNESS_CACHE_MS after a forced rebuild.
      this.freshnessCache = null;
      const elapsed = this.lastIndexedTime - startTime;
      log(
        `Indexing complete: ${this.fileStore.count()} files, ` +
          `${this.chunkStore.count()} chunks in ${elapsed}ms`
      );

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

        const embText = description + "\n" + chunk.content.slice(0, 512);
        const [vector] = await this.embed([embText]);
        this.embeddingStore.insert(chunkId, vector);
      }
    } catch (err) {
      logError(`Failed to reindex ${relativePath}`, err);
    }
  }

  removeFile(relativePath: string): void {
    this.fileStore.delete(relativePath);
  }

  getStatus(): IndexStatus {
    return {
      projectName: this.config.name,
      rootPath: this.config.rootPath,
      fileCount: this.fileStore.count(),
      chunkCount: this.chunkStore.count(),
      languages: this.fileStore.getLanguages(),
      lastIndexedAt: this.lastIndexedTime,
      indexing: this.indexing,
      progress: this.indexing ? this.progress : undefined,
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
   */
  clearIndex(): void {
    // Close existing connection
    try {
      this.db.close();
    } catch {
      // already closed
    }

    // Delete the .db file (and sqlite sidecars if present)
    const dbPath = this.config.dbPath;
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      const p = dbPath + suffix;
      if (existsSync(p)) {
        try {
          unlinkSync(p);
        } catch (err) {
          logError(`Failed to delete ${p}`, err);
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
  }
}

function hashFile(filePath: string): string {
  const content = readFileSync(filePath, "utf-8");
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

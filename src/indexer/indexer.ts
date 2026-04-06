import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { createDatabase } from "../storage/database.js";
import { FileStore } from "../storage/file-store.js";
import { ChunkStore } from "../storage/chunk-store.js";
import { EmbeddingStore } from "../storage/embedding-store.js";
import { GraphStore } from "../storage/graph-store.js";
import { MemoryStore } from "../storage/memory-store.js";
import { MemoryEmbeddingStore } from "../storage/memory-embedding-store.js";
import { discoverFiles } from "./file-discovery.js";
import { parseFile } from "./parser.js";
import { describeChunk } from "./describer.js";
import { embed, initEmbedder } from "./embedder.js";
import { buildGraph } from "./graph-builder.js";
import { createIgnoreFilter } from "../utils/ignore.js";
import { estimateTokens } from "../utils/tokens.js";
import { log, logError } from "../utils/logger.js";
import type { ProjectConfig, ImportRef, IndexStatus } from "../types/index.js";

export class Indexer {
  private db: Database.Database;
  public fileStore: FileStore;
  public chunkStore: ChunkStore;
  public embeddingStore: EmbeddingStore;
  public graphStore: GraphStore;
  public memoryStore: MemoryStore;
  public memoryEmbeddingStore: MemoryEmbeddingStore;
  private indexing = false;
  private progress = { done: 0, total: 0 };
  private lastIndexedTime: number | null = null;

  constructor(private config: ProjectConfig) {
    this.db = createDatabase(config.dbPath);
    this.fileStore = new FileStore(this.db);
    this.chunkStore = new ChunkStore(this.db);
    this.embeddingStore = new EmbeddingStore(this.db);
    this.graphStore = new GraphStore(this.db);
    this.memoryStore = new MemoryStore(this.db);
    this.memoryEmbeddingStore = new MemoryEmbeddingStore(this.db);
  }

  get rootPath(): string {
    return this.config.rootPath;
  }

  async index(): Promise<void> {
    if (this.indexing) return;
    this.indexing = true;

    try {
      log(`Indexing ${this.config.rootPath}...`);
      const startTime = Date.now();

      await initEmbedder();

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
        const vectors = await embed(texts);

        for (let j = 0; j < batch.length; j++) {
          this.embeddingStore.insert(batch[j].chunkId, vectors[j]);
        }
      }

      // 6. Rebuild FTS index (ensures sync with content table)
      this.db.exec("INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild')");

      // 7. Build dependency graph and compute PageRank
      log("Building dependency graph...");
      buildGraph(fileImports, this.fileStore, this.graphStore, this.config.rootPath);

      // 8. Update project metadata
      this.lastIndexedTime = Date.now();
      const elapsed = this.lastIndexedTime - startTime;
      log(
        `Indexing complete: ${this.fileStore.count()} files, ` +
          `${this.chunkStore.count()} chunks in ${elapsed}ms`
      );
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

        const embText = description + "\n" + chunk.content.slice(0, 512);
        const [vector] = await embed([embText]);
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

  close(): void {
    this.db.close();
  }
}

function hashFile(filePath: string): string {
  const content = readFileSync(filePath, "utf-8");
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

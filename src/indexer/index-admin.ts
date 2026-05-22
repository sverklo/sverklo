/**
 * Lifecycle/admin surface of the Indexer.
 *
 * Used by entrypoints that own the index lifetime: bin/sverklo.ts,
 * mcp-server, http-server, indexer-pool, and src/index.ts. These are
 * the only consumers that should construct, mutate, or close the
 * underlying database — everything else should hold a narrower
 * read-only or memory interface.
 *
 * Keep in sync with `class Indexer` in indexer.ts. Full plan:
 * docs/refactor-plan-indexer-coupling.md.
 */
export interface ClearIndexResult {
  deleted: string[];
  failed: Array<{ path: string; error: NodeJS.ErrnoException }>;
}

export interface IndexAdmin {
  index(): Promise<void>;
  reindexFile(relativePath: string, absolutePath: string, language: string): Promise<void>;
  removeFile(relativePath: string): void;
  clearIndex(): ClearIndexResult;
  close(): void;
  invalidateFreshnessCache(): void;
}

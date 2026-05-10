import type { ChunkStore } from "../storage/chunk-store.js";
import type { SymbolRefStore } from "../storage/symbol-ref-store.js";
import type { DocEdgeStore } from "../storage/doc-edge-store.js";
import { EmbeddingStore } from "../storage/embedding-store.js";

/**
 * Code-symbol surface of the Indexer.
 *
 * Used by symbol-resolution tools (search, lookup, refs, ast-grep) and
 * any consumer that needs chunk content + cross-reference graphs +
 * doc/code edges, plus the `embed()` entry point for query encoding
 * and the embeddingStore for vector similarity.
 *
 * Keep in sync with `class Indexer` in indexer.ts. Full plan:
 * docs/refactor-plan-indexer-coupling.md.
 */
export interface IndexCode {
  readonly chunkStore: ChunkStore;
  readonly symbolRefStore: SymbolRefStore;
  readonly docEdgeStore: DocEdgeStore;
  readonly embeddingStore: EmbeddingStore;
  embed(texts: string[]): Promise<Float32Array[]>;
}

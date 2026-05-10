import type { MemoryStore } from "../storage/memory-store.js";
import type { MemoryEmbeddingStore } from "../storage/memory-embedding-store.js";
import type { ConceptStore } from "../storage/concept-store.js";
import type { HandleStore } from "../storage/handle-store.js";
import type { PatternStore } from "../storage/pattern-store.js";
import type { EvidenceStore } from "../storage/evidence-store.js";
import type { MemoryJournal } from "../memory/journal.js";

/**
 * Memory + persistent-context surface of the Indexer.
 *
 * Used by remember/recall/forget/pin tools, the memory import/export
 * paths, and the concept/pattern/handle/evidence side-stores.
 * `embed()` is included so callers can encode query text against the
 * memory embedding store. `rootPath` is included because journal/git
 * lookups are scoped to it.
 *
 * Keep in sync with `class Indexer` in indexer.ts. Full plan:
 * docs/refactor-plan-indexer-coupling.md.
 */
export interface IndexMemory {
  readonly memoryStore: MemoryStore;
  readonly memoryEmbeddingStore: MemoryEmbeddingStore;
  readonly memoryJournal: MemoryJournal;
  readonly conceptStore: ConceptStore;
  readonly handleStore: HandleStore;
  readonly patternStore: PatternStore;
  readonly evidenceStore: EvidenceStore;
  readonly rootPath: string;
  embed(texts: string[]): Promise<Float32Array[]>;
}

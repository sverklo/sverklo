import type { FileStore } from "../storage/file-store.js";
import type { GraphStore } from "../storage/graph-store.js";

/**
 * Dependency-graph surface of the Indexer.
 *
 * Used by tools that walk the import graph: deps, impact, audit-graph,
 * and PageRank-based search bundles. Pairs fileStore (resolve ids ↔
 * paths) with graphStore (the edges).
 *
 * Keep in sync with `class Indexer` in indexer.ts. Full plan:
 * docs/refactor-plan-indexer-coupling.md.
 */
export interface IndexGraph {
  readonly fileStore: FileStore;
  readonly graphStore: GraphStore;
}

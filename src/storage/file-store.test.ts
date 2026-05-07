import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { FileStore } from "./file-store.js";
import { GraphStore } from "./graph-store.js";
import { createDatabase } from "./database.js";

// Regression for sv-p4-04: when a file is modified and re-indexed,
// FileStore.upsert used INSERT OR REPLACE, which deletes-and-reinserts
// the row. ON DELETE CASCADE on dependencies.{source,target}_file_id
// then wipes every edge involving that file — both outgoing AND incoming.
//
// buildGraph only re-adds OUTGOING edges (it iterates fileImports for
// the re-indexed file). Incoming edges from cached source files are
// never restored, so a→b silently disappears every time b is touched.
//
// On a long-lived index this accumulates: in the production sverklo DB
// indexer.ts (low file_id, never re-parsed) had lost edges to chunk-store,
// memory-store, pattern-store, parser, embedder, and types/index — the six
// files whose ids were highest in the table because they'd been re-indexed.
// sv-p4-04 (the bench task asking who imports chunk-store.ts) returned 0
// importers as a result.
//
// The fix is INSERT ... ON CONFLICT(path) DO UPDATE SET ..., which mutates
// the row in place. The row's id is preserved, no cascade fires, edges live.

describe("FileStore.upsert preserves dependency edges across re-index", () => {
  let db: Database.Database;
  let fileStore: FileStore;
  let graphStore: GraphStore;

  beforeEach(() => {
    db = createDatabase(":memory:");
    fileStore = new FileStore(db);
    graphStore = new GraphStore(db);
  });

  it("does not cascade-delete incoming edges when a target file is updated", () => {
    const aId = fileStore.upsert("src/a.ts", "typescript", "hash-a-v1", 1000, 100);
    const bId = fileStore.upsert("src/b.ts", "typescript", "hash-b-v1", 1000, 100);
    graphStore.upsert(aId, bId, 1);

    expect(graphStore.getImporters(bId)).toHaveLength(1);

    // Re-upsert b.ts with a changed hash (simulates a file edit being
    // re-indexed). The dependency edge from a→b must survive.
    const bIdAfter = fileStore.upsert("src/b.ts", "typescript", "hash-b-v2", 2000, 200);

    const importers = graphStore.getImporters(bIdAfter);
    expect(importers).toHaveLength(1);
    expect(importers[0].source_file_id).toBe(aId);
  });

  it("does not change the file id when an existing path is upserted", () => {
    const aId = fileStore.upsert("src/a.ts", "typescript", "hash-v1", 1000, 100);
    const aIdAfter = fileStore.upsert("src/a.ts", "typescript", "hash-v2", 2000, 200);
    expect(aIdAfter).toBe(aId);
  });

  it("preserves pagerank across upsert (it is recomputed by buildGraph, not the row update)", () => {
    const aId = fileStore.upsert("src/a.ts", "typescript", "hash-v1", 1000, 100);
    db.prepare("UPDATE files SET pagerank = ? WHERE id = ?").run(0.42, aId);

    fileStore.upsert("src/a.ts", "typescript", "hash-v2", 2000, 200);

    const row = db.prepare("SELECT pagerank FROM files WHERE id = ?").get(aId) as { pagerank: number };
    expect(row.pagerank).toBeCloseTo(0.42, 5);
  });

  it("updates the metadata fields on conflict", () => {
    const id = fileStore.upsert("src/a.ts", "typescript", "h1", 1000, 100);
    fileStore.upsert("src/a.ts", "typescript", "h2", 9999, 9999);
    const row = fileStore.getByPath("src/a.ts");
    expect(row?.id).toBe(id);
    expect(row?.hash).toBe("h2");
    expect(row?.last_modified).toBe(9999);
    expect(row?.size_bytes).toBe(9999);
  });
});

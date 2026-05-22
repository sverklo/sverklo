import { describe, it, expect, beforeEach } from "vitest";
import type { Database } from "./database.js";
import { createDatabase } from "./database.js";
import { EmbeddingStore } from "./embedding-store.js";
import { ChunkStore } from "./chunk-store.js";
import { FileStore } from "./file-store.js";

// Regression for issue #59 (v0.25.0). The bug surfaced as 384-dim
// vectors in the embeddings table after a user configured Ollama with
// a 1024-dim Qwen3 model. Two layers were involved: (1) the indexer
// silently ignored .sverklo.yaml `embeddings.provider` and fell back
// to the bundled 384-dim MiniLM, and (2) it was unclear whether the
// storage layer itself was truncating non-384-dim input.
//
// This test pins (2) down: the embedding store must round-trip
// arbitrary-dimensional Float32Array buffers without truncation. The
// schema is `vector BLOB NOT NULL` with no length constraint, so this
// is mostly a guard against a future "let's normalize the BLOB width"
// refactor that would re-introduce the silent-truncation failure mode.

describe("EmbeddingStore — dim-agnostic storage (issue #59)", () => {
  let db: Database;
  let embeddingStore: EmbeddingStore;
  let chunkStore: ChunkStore;
  let fileStore: FileStore;
  let chunkId: number;

  beforeEach(() => {
    db = createDatabase(":memory:");
    fileStore = new FileStore(db);
    chunkStore = new ChunkStore(db);
    embeddingStore = new EmbeddingStore(db);

    const fileId = fileStore.upsert("src/a.ts", "typescript", "hash", 1000, 500);
    chunkId = chunkStore.insert(
      fileId,
      "function",
      "hello",
      null,
      1,
      3,
      "export function hello() {}",
      null,
      5,
    );
  });

  it("round-trips a 1024-dim vector (e.g. Ollama qwen3-embedding:0.6b)", () => {
    // Pattern: every i-th element is i/1024 so we can detect any
    // truncation by checking the tail values, not just the length.
    const dim = 1024;
    const input = new Float32Array(dim);
    for (let i = 0; i < dim; i++) input[i] = i / dim;

    embeddingStore.insert(chunkId, input);

    const out = embeddingStore.get(chunkId);
    expect(out).toBeDefined();
    expect(out!.length).toBe(dim);
    // Tail check: if storage truncates to 384, this is 0 instead of 1023/1024.
    expect(out![dim - 1]).toBeCloseTo((dim - 1) / dim, 5);
    expect(out![dim - 2]).toBeCloseTo((dim - 2) / dim, 5);
    expect(out![0]).toBeCloseTo(0, 5);
  });

  it("round-trips a 384-dim vector (bundled MiniLM) without dimensional drift", () => {
    const dim = 384;
    const input = new Float32Array(dim);
    for (let i = 0; i < dim; i++) input[i] = Math.sin(i);

    embeddingStore.insert(chunkId, input);

    const out = embeddingStore.get(chunkId);
    expect(out).toBeDefined();
    expect(out!.length).toBe(dim);
    expect(out![dim - 1]).toBeCloseTo(Math.sin(dim - 1), 4);
  });

  it("reports the same dim back from getAll() that was inserted", () => {
    // Spot-check that the bulk read path doesn't slice either.
    const dim = 1536; // text-embedding-3-small width
    const v = new Float32Array(dim);
    v[1535] = 0.42;
    embeddingStore.insert(chunkId, v);

    const all = embeddingStore.getAll();
    const got = all.get(chunkId);
    expect(got).toBeDefined();
    expect(got!.length).toBe(dim);
    expect(got![1535]).toBeCloseTo(0.42, 5);
  });
});

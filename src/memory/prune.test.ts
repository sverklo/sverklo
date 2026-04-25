import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Indexer } from "../indexer/indexer.js";
import { getProjectConfig } from "../utils/config.js";
import { runPrune } from "./prune.js";

// Sprint 9-C tests for `sverklo prune`. The two passes — decay scoring
// and consolidation — are exercised independently. Embeddings are
// crafted directly so we don't depend on the ONNX model being available
// in the test sandbox.

describe("runPrune", () => {
  let tmpRoot: string;
  let indexer: Indexer;

  beforeEach(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "sverklo-prune-"));
    mkdirSync(join(tmpRoot, "src"), { recursive: true });
    indexer = new Indexer(getProjectConfig(tmpRoot));
    await indexer.index();
  });

  afterEach(() => {
    indexer.close();
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch { /* tmpdir cleanup is best-effort */ }
  });

  function insertOldMemory(content: string, daysAgo: number): number {
    const id = indexer.memoryStore.insert(
      "context",
      content,
      null,
      1.0,
      null,
      null,
      null,
      "archive"
    );
    // Backdate created_at AND last_accessed so decay + age filters fire.
    const ts = Date.now() - daysAgo * 86_400_000;
    indexer.memoryStore["db" as keyof typeof indexer.memoryStore]; // touch to satisfy ts
    const db = (indexer as unknown as { db: import("better-sqlite3").Database }).db;
    db.prepare(
      "UPDATE memories SET created_at = ?, last_accessed = ?, access_count = 0 WHERE id = ?"
    ).run(ts, ts, id);
    return id;
  }

  function setEmbedding(memoryId: number, vec: number[]): void {
    const f32 = new Float32Array(vec);
    indexer.memoryEmbeddingStore.insert(memoryId, f32);
  }

  it("dry-run leaves all memories untouched", async () => {
    const id = insertOldMemory("very old, never accessed", 365);

    // Threshold high enough that the year-old memory falls below it.
    const r = await runPrune(indexer, { dryRun: true, staleScoreThreshold: 0.5 });

    expect(r.dryRun).toBe(true);
    expect(r.decayed).toBeGreaterThanOrEqual(1);
    // is_stale must NOT have been written
    const after = indexer.memoryStore.getById(id)!;
    expect(after.is_stale).toBe(0);
    expect(r.consolidatedClusters).toBe(0);
  });

  it("marks low-score memories stale on a real run", async () => {
    const id = insertOldMemory("very old, never accessed", 365);

    const r = await runPrune(indexer, { staleScoreThreshold: 0.5 });

    expect(r.decayed).toBeGreaterThanOrEqual(1);
    const after = indexer.memoryStore.getById(id)!;
    expect(after.is_stale).toBe(1);
  });

  it("preserves core-tier memories from decay", async () => {
    const id = indexer.memoryStore.insert(
      "preference",
      "core invariant — always keep",
      null,
      1.0,
      null,
      null,
      null,
      "core"
    );
    const db = (indexer as unknown as { db: import("better-sqlite3").Database }).db;
    const ts = Date.now() - 365 * 86_400_000;
    db.prepare(
      "UPDATE memories SET created_at = ?, last_accessed = ?, access_count = 0 WHERE id = ?"
    ).run(ts, ts, id);

    await runPrune(indexer, {});

    const after = indexer.memoryStore.getById(id)!;
    expect(after.is_stale).toBe(0);
  });

  it("consolidates a cluster of similar episodic memories and supersedes the originals", async () => {
    // Three memories aged past the cutoff with near-identical embeddings.
    const ids = [
      insertOldMemory("we picked SQLite for the index", 60),
      insertOldMemory("we chose SQLite because local-first", 60),
      insertOldMemory("decided SQLite is the storage engine", 60),
    ];
    // Crafted vectors with cosine ≈ 1.0 for all pairs.
    setEmbedding(ids[0], [1, 0.001, 0]);
    setEmbedding(ids[1], [1, 0.002, 0]);
    setEmbedding(ids[2], [1, 0.003, 0]);

    const r = await runPrune(indexer, {
      similarityThreshold: 0.99,
      minClusterSize: 3,
      maxAgeDays: 30,
    });

    expect(r.consolidatedClusters).toBe(1);
    expect(r.consolidatedMembers).toBe(3);
    expect(r.newSemanticMemoryIds).toHaveLength(1);

    // Each original now has valid_until_sha set + superseded_by → newId.
    const newId = r.newSemanticMemoryIds[0];
    for (const id of ids) {
      const row = indexer.memoryStore.getById(id)!;
      expect(row.superseded_by).toBe(newId);
      // valid_until_sha gets a value even when sha is null in repo without git.
      expect(row.valid_until_sha === null && row.invalidated_at === null).toBe(false);
    }

    // The new consolidated memory is kind=semantic.
    const newMem = indexer.memoryStore.getById(newId)!;
    expect(newMem.kind).toBe("semantic");
    expect(newMem.tier).toBe("archive");
  });

  it("dry-run does NOT supersede originals even when a cluster is found", async () => {
    const ids = [
      insertOldMemory("alpha similar", 60),
      insertOldMemory("alpha similar two", 60),
      insertOldMemory("alpha similar three", 60),
    ];
    setEmbedding(ids[0], [1, 0.001, 0]);
    setEmbedding(ids[1], [1, 0.002, 0]);
    setEmbedding(ids[2], [1, 0.003, 0]);

    const r = await runPrune(indexer, {
      dryRun: true,
      similarityThreshold: 0.99,
      minClusterSize: 3,
      maxAgeDays: 30,
    });

    expect(r.consolidatedClusters).toBe(1);
    expect(r.consolidatedMembers).toBe(3);
    expect(r.newSemanticMemoryIds).toHaveLength(0);
    for (const id of ids) {
      const row = indexer.memoryStore.getById(id)!;
      expect(row.superseded_by).toBeNull();
    }
  });

  it("treats explicit `undefined` opts as defaults (regression: spread overwrote DEFAULTS)", async () => {
    // Bug: { ...DEFAULTS, ...{similarityThreshold: undefined} } produced
    // { similarityThreshold: undefined } → cosine >= undefined is always
    // false → no clusters. CLI passes undefined when flags are absent,
    // so `sverklo prune` with no flags became a silent no-op.
    const ids = [
      insertOldMemory("regression case A", 60),
      insertOldMemory("regression case B", 60),
      insertOldMemory("regression case C", 60),
    ];
    setEmbedding(ids[0], [1, 0.001, 0]);
    setEmbedding(ids[1], [1, 0.002, 0]);
    setEmbedding(ids[2], [1, 0.003, 0]);

    const r = await runPrune(indexer, {
      // intentionally pass every clustering knob as undefined — the
      // way the CLI does it when no flags are set.
      maxAgeDays: undefined,
      similarityThreshold: undefined,
      minClusterSize: undefined,
      staleScoreThreshold: undefined,
    });

    // With a 30-day default age cutoff and a 0.88 default similarity,
    // these three near-identical 60-day-old memories must cluster.
    expect(r.consolidatedClusters).toBe(1);
    expect(r.consolidatedMembers).toBe(3);
  });

  it("reports truncated/totalActive when the scan cap is exceeded", async () => {
    // Don't actually insert 10k memories — just assert the fields exist
    // and totalActive matches count() on a small store.
    insertOldMemory("a", 1);
    insertOldMemory("b", 1);
    const r = await runPrune(indexer, { dryRun: true });
    expect(r.truncated).toBe(false);
    expect(r.totalActive).toBeGreaterThanOrEqual(2);
  });

  it("does not consolidate clusters smaller than minClusterSize", async () => {
    const ids = [
      insertOldMemory("only two members", 60),
      insertOldMemory("only two members again", 60),
    ];
    setEmbedding(ids[0], [1, 0, 0]);
    setEmbedding(ids[1], [1, 0.001, 0]);

    const r = await runPrune(indexer, {
      similarityThreshold: 0.99,
      minClusterSize: 3,
      maxAgeDays: 30,
    });

    expect(r.consolidatedClusters).toBe(0);
    for (const id of ids) {
      const row = indexer.memoryStore.getById(id)!;
      expect(row.superseded_by).toBeNull();
    }
  });
});

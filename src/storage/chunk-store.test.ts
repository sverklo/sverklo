import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { ChunkStore } from "./chunk-store.js";
import { FileStore } from "./file-store.js";
import { createDatabase } from "./database.js";

// Tests for the getByNameWithFile JOIN that backs the sverklo_lookup
// perf fix (issue #6). Previously lookup called chunkStore.getByName
// + a separate fileStore.getAll() scan — the scan dominated first-call
// latency. The JOIN method should return the same chunks but sorted by
// pagerank DESC with the file path and language attached.

describe("ChunkStore.getByNameWithFile", () => {
  let db: Database.Database;
  let chunkStore: ChunkStore;
  let fileStore: FileStore;

  beforeEach(() => {
    db = createDatabase(":memory:");
    fileStore = new FileStore(db);
    chunkStore = new ChunkStore(db);

    // Seed two files with different pagerank and matching chunk names.
    const fileA = fileStore.upsert("src/a.ts", "typescript", "hash-a", 1000, 500);
    const fileB = fileStore.upsert("src/b.ts", "typescript", "hash-b", 2000, 800);

    // Set pagerank so we can verify ordering
    db.prepare("UPDATE files SET pagerank = ? WHERE id = ?").run(0.9, fileA);
    db.prepare("UPDATE files SET pagerank = ? WHERE id = ?").run(0.1, fileB);

    // Insert chunks: both have a symbol called "handleRequest"
    chunkStore.insert(fileA, "function", "handleRequest", "function handleRequest() {}", 10, 15, "body a", "desc a", 20);
    chunkStore.insert(fileB, "function", "handleRequest", "function handleRequest() {}", 22, 27, "body b", "desc b", 20);
    chunkStore.insert(fileA, "class", "UnrelatedClass", "class UnrelatedClass {}", 40, 45, "body c", "desc c", 15);
  });

  it("returns matching chunks with file path and language joined", () => {
    const result = chunkStore.getByNameWithFile("handleRequest", 10);

    expect(result).toHaveLength(2);
    // Both results should have filePath populated
    expect(result.every((r) => r.filePath.length > 0)).toBe(true);
    // Language should come from the file record
    expect(result.every((r) => r.fileLanguage === "typescript")).toBe(true);
  });

  it("orders results by file pagerank DESC", () => {
    const result = chunkStore.getByNameWithFile("handleRequest", 10);

    // Fields should be sorted: file A (0.9) before file B (0.1)
    expect(result[0].filePath).toBe("src/a.ts");
    expect(result[0].pagerank).toBe(0.9);
    expect(result[1].filePath).toBe("src/b.ts");
    expect(result[1].pagerank).toBe(0.1);
  });

  it("respects the limit parameter", () => {
    const result = chunkStore.getByNameWithFile("handleRequest", 1);
    expect(result).toHaveLength(1);
  });

  it("returns empty array when no chunks match", () => {
    const result = chunkStore.getByNameWithFile("nonexistentSymbol", 10);
    expect(result).toEqual([]);
  });

  it("supports prefix match via the wildcard", () => {
    // getByNameWithFile wraps the input in LIKE '%<name>%' so substring
    // matches work — same contract as the legacy getByName.
    const result = chunkStore.getByNameWithFile("handle", 10);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((r) => r.name?.includes("handle"))).toBe(true);
  });

  it("returns the same chunks as getByName (but with extra fields)", () => {
    const joined = chunkStore.getByNameWithFile("handleRequest", 10);
    const legacy = chunkStore.getByName("handleRequest", 10);

    expect(joined.length).toBe(legacy.length);
    const joinedIds = new Set(joined.map((c) => c.id));
    const legacyIds = new Set(legacy.map((c) => c.id));
    expect(joinedIds).toEqual(legacyIds);
  });
});

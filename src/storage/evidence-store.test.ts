import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { createDatabase } from "./database.js";
import { EvidenceStore, hashSpan, spanSimilarity } from "./evidence-store.js";

function mkDb() {
  // In-memory SQLite keeps the test fast + isolated.
  const db = createDatabase(":memory:");
  return db;
}

describe("hashSpan", () => {
  it("produces stable sha256 hex", () => {
    const h1 = hashSpan("function x() { return 42; }");
    const h2 = hashSpan("function x() { return 42; }");
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });
});

describe("spanSimilarity", () => {
  it("returns 1.0 for identical spans", () => {
    expect(spanSimilarity("a b c", "a b c")).toBe(1);
  });
  it("returns 0 for disjoint token bags", () => {
    expect(spanSimilarity("alpha beta", "xxx yyy")).toBe(0);
  });
  it("returns Jaccard ratio for partial overlap", () => {
    // tokens(A) = {alpha, beta}, tokens(B) = {alpha, gamma}
    // shared 1, union 3 → 1/3
    const sim = spanSimilarity("alpha beta", "alpha gamma");
    expect(sim).toBeCloseTo(1 / 3, 3);
  });
});

describe("EvidenceStore", () => {
  it("round-trips an evidence row through the store", () => {
    const db = mkDb();
    const store = new EvidenceStore(db);
    const id = store.insert({
      file: "src/auth.ts",
      start_line: 10,
      end_line: 45,
      commit_sha: "abc123",
      chunk_id: 7,
      symbol: "authenticate",
      method: "fts",
      score: 0.42,
      content_hash: hashSpan("function authenticate() {}"),
    });
    expect(id).toMatch(/^ev_[a-f0-9]{12}$/);
    const row = store.getById(id);
    expect(row).toBeTruthy();
    expect(row!.file).toBe("src/auth.ts");
    expect(row!.symbol).toBe("authenticate");
    expect(row!.method).toBe("fts");
  });

  it("purges rows older than the TTL", () => {
    const db = mkDb();
    const store = new EvidenceStore(db);
    store.insert({
      file: "f.ts", start_line: 1, end_line: 5,
      commit_sha: null, chunk_id: null, symbol: null,
      method: "fts", score: 1, content_hash: hashSpan("x"),
    });
    expect(store.count()).toBe(1);
    // Force a purge with a future "now" beyond the 24h TTL.
    const FAR_FUTURE = Date.now() + 48 * 60 * 60 * 1000;
    store.purge(FAR_FUTURE);
    expect(store.count()).toBe(0);
  });

  it("toEvidence converts a stored row to the public shape", () => {
    const db = mkDb();
    const store = new EvidenceStore(db);
    const id = store.insert({
      file: "f.ts", start_line: 1, end_line: 5,
      commit_sha: "sha", chunk_id: 1, symbol: "foo",
      method: "vector", score: 0.3, content_hash: hashSpan("x"),
    });
    const row = store.getById(id)!;
    const pub = store.toEvidence(row);
    expect(pub.id).toBe(id);
    expect(pub.lines).toEqual([1, 5]);
    expect(pub.method).toBe("vector");
    expect(pub.symbol).toBe("foo");
  });

  it("returns null for unknown ids", () => {
    const db = mkDb();
    const store = new EvidenceStore(db);
    expect(store.getById("ev_nonexistent")).toBeNull();
  });
});

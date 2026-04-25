import { describe, it, expect } from "vitest";
import { createDatabase } from "./database.js";
import { ConceptStore, clusterContentHash } from "./concept-store.js";

function mkDb() {
  return createDatabase(":memory:");
}

describe("clusterContentHash", () => {
  it("is stable under member-id reordering", () => {
    expect(clusterContentHash([3, 1, 2], 10)).toBe(clusterContentHash([1, 2, 3], 10));
  });

  it("changes when membership changes", () => {
    expect(clusterContentHash([1, 2, 3], 10)).not.toBe(clusterContentHash([1, 2, 3, 4], 10));
  });
});

describe("ConceptStore", () => {
  it("round-trips a concept record", () => {
    const db = mkDb();
    const store = new ConceptStore(db);
    store.upsert({
      cluster_id: 42,
      label: "Auth subsystem",
      summary: "JWT issuance, validation, middleware.",
      tags: ["auth", "jwt", "middleware"],
      hub_file: "src/auth/index.ts",
      member_count: 7,
      content_hash: "hash-1",
    });
    const row = store.get(42);
    expect(row).toBeTruthy();
    expect(row!.label).toBe("Auth subsystem");
    expect(row!.tags).toBe("auth,jwt,middleware");
  });

  it("upsert overwrites existing rows by cluster_id", () => {
    const db = mkDb();
    const store = new ConceptStore(db);
    store.upsert({
      cluster_id: 1, label: "v1", summary: null, tags: [], hub_file: null,
      member_count: 1, content_hash: "h1",
    });
    store.upsert({
      cluster_id: 1, label: "v2", summary: null, tags: [], hub_file: null,
      member_count: 1, content_hash: "h2",
    });
    expect(store.count()).toBe(1);
    expect(store.get(1)!.label).toBe("v2");
  });

  it("round-trips an embedding vector", () => {
    const db = mkDb();
    const store = new ConceptStore(db);
    store.upsert({
      cluster_id: 1, label: "x", summary: null, tags: [], hub_file: null,
      member_count: 1, content_hash: "h",
    });
    const vec = new Float32Array([0.1, 0.2, 0.3]);
    store.upsertEmbedding(1, vec);
    const round = store.getEmbedding(1)!;
    expect(round.length).toBe(3);
    expect(round[0]).toBeCloseTo(0.1, 5);
    expect(round[1]).toBeCloseTo(0.2, 5);
    expect(round[2]).toBeCloseTo(0.3, 5);
  });
});

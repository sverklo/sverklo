import { describe, it, expect, vi } from "vitest";
import { handleRecall } from "./recall.js";
import type { Memory } from "../../types/index.js";

// Tests for the new mode=core / mode=archival / mode=all recall paths
// (issue #11). The mode=core branch returns the always-on invariants
// without running the search pipeline at all, so we can test it with
// a pure in-memory fake indexer — no embeddings, no DB, no git state.

function mkMemory(overrides: Partial<Memory>): Memory {
  return {
    id: 1,
    category: "context",
    content: "base memory",
    tags: null,
    confidence: 1.0,
    git_sha: null,
    git_branch: null,
    related_files: null,
    tier: "archive",
    valid_from_sha: null,
    valid_until_sha: null,
    created_at: Date.now(),
    updated_at: Date.now(),
    last_accessed: Date.now(),
    access_count: 0,
    is_stale: 0 as unknown as boolean,
    ...overrides,
  } as Memory;
}

function fakeIndexerWithCore(coreMemories: Memory[]) {
  return {
    memoryStore: {
      getCore: (limit: number) => coreMemories.slice(0, limit),
      searchFts: () => [],
      getById: (id: number) => coreMemories.find((m) => m.id === id),
      touchAccess: () => {},
    },
    memoryEmbeddingStore: {
      getAll: () => new Map(),
    },
    fileStore: {
      getAll: () => [],
    },
    rootPath: "/tmp/fake",
  } as unknown as Parameters<typeof handleRecall>[0];
}

// Mock telemetry + staleness so we don't need any of the real ones.
vi.mock("../../memory/staleness.js", () => ({
  checkStaleness: () => false,
}));
vi.mock("../../telemetry/index.js", () => ({
  track: () => {},
}));
vi.mock("../../indexer/embedder.js", () => ({
  embed: async () => [new Float32Array(384)],
  cosineSimilarity: () => 0,
}));

describe("handleRecall — mode=core", () => {
  it("returns a helpful empty-state message when no core memories exist", async () => {
    const indexer = fakeIndexerWithCore([]);
    const out = await handleRecall(indexer, { mode: "core" });
    expect(out).toContain("No core memories");
    expect(out).toContain("sverklo_promote");
    expect(out).toContain("sverklo_remember");
  });

  it("returns all core memories when populated", async () => {
    const indexer = fakeIndexerWithCore([
      mkMemory({ id: 1, content: "All timestamps are UTC.", tier: "core", category: "procedural" }),
      mkMemory({ id: 2, content: "Use Postgres, not MySQL.", tier: "core", category: "decision" }),
    ]);
    const out = await handleRecall(indexer, { mode: "core" });
    expect(out).toContain("All timestamps are UTC.");
    expect(out).toContain("Use Postgres, not MySQL.");
    expect(out).toContain("procedural");
    expect(out).toContain("decision");
  });

  it("does not require a query in core mode", async () => {
    const indexer = fakeIndexerWithCore([
      mkMemory({ id: 1, content: "A core rule", tier: "core" }),
    ]);
    // No query field — should still work
    const out = await handleRecall(indexer, { mode: "core" });
    expect(out).toContain("A core rule");
  });

  it("filters by category when provided", async () => {
    const indexer = fakeIndexerWithCore([
      mkMemory({ id: 1, content: "Always do X", tier: "core", category: "procedural" }),
      mkMemory({ id: 2, content: "Prefer Y", tier: "core", category: "preference" }),
    ]);
    const out = await handleRecall(indexer, { mode: "core", category: "procedural" });
    expect(out).toContain("Always do X");
    expect(out).not.toContain("Prefer Y");
  });

  it("warns when core tier exceeds the soft limit (25)", async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      mkMemory({ id: i + 1, content: `memory ${i + 1}`, tier: "core" })
    );
    const indexer = fakeIndexerWithCore(many);

    const out = await handleRecall(indexer, { mode: "core" });
    expect(out).toContain("30 core memories");
    expect(out).toContain("soft limit");
    expect(out).toContain("sverklo_demote");
  });

  it("does not warn below the soft limit", async () => {
    const few = Array.from({ length: 5 }, (_, i) =>
      mkMemory({ id: i + 1, content: `memory ${i + 1}`, tier: "core" })
    );
    const indexer = fakeIndexerWithCore(few);
    const out = await handleRecall(indexer, { mode: "core" });
    expect(out).not.toContain("soft limit");
  });
});

describe("handleRecall — mode=archival requires a query", () => {
  it("returns an error message if no query is provided", async () => {
    const indexer = fakeIndexerWithCore([]);
    const out = await handleRecall(indexer, { mode: "archival" });
    expect(out).toContain("query");
    expect(out).toContain("required");
    expect(out).toContain("mode:core");
  });
});

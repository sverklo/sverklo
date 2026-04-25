import { describe, it, expect } from "vitest";
import { dedupChunks, groupByDirectory, middleTruncate } from "./compact.js";
import type { SearchResult, CodeChunk, FileRecord } from "../types/index.js";

function mkChunk(id: number, content: string): CodeChunk {
  return {
    id,
    file_id: 1,
    type: "function",
    name: `fn${id}`,
    signature: null,
    start_line: 1,
    end_line: 10,
    content,
    description: null,
    token_count: 100,
  };
}

function mkFile(id: number, path: string): FileRecord {
  return {
    id,
    path,
    language: "typescript",
    hash: "h",
    last_modified: 0,
    size_bytes: 100,
    pagerank: 0,
    indexed_at: 0,
  };
}

function mkResult(id: number, path: string, content: string, score: number): SearchResult {
  const chunk = mkChunk(id, content);
  chunk.file_id = id; // keep file_id aligned so dedup operates per-file
  return { chunk, file: mkFile(id, path), score };
}

describe("dedupChunks", () => {
  it("is a no-op when all chunks differ", () => {
    const results = [
      mkResult(1, "a.ts", "alpha body one", 0.9),
      mkResult(2, "b.ts", "beta body two", 0.8),
      mkResult(3, "c.ts", "gamma body three", 0.7),
    ];
    const { kept, collapsed } = dedupChunks(results);
    expect(kept).toHaveLength(3);
    expect(collapsed.size).toBe(0);
  });

  it("collapses near-duplicate chunks in the same file", () => {
    const a = mkResult(1, "src/a.ts", "function foo() { return 42; }", 0.9);
    const b = mkResult(2, "src/a.ts", "function foo() { return 42; }", 0.7);
    // Force same file_id so dedup key matches.
    b.chunk.file_id = a.chunk.file_id;
    b.file = a.file;
    const { kept, collapsed } = dedupChunks([a, b]);
    expect(kept).toHaveLength(1);
    expect(kept[0].score).toBe(0.9);
    expect(collapsed.get(a.chunk.id)).toBe(1);
  });

  it("does not dedup chunks in different files", () => {
    const results = [
      mkResult(1, "a.ts", "same body", 0.9),
      mkResult(2, "b.ts", "same body", 0.8),
    ];
    const { kept } = dedupChunks(results);
    expect(kept).toHaveLength(2);
  });
});

describe("groupByDirectory", () => {
  it("leaves pairs alone (threshold is 3)", () => {
    const results = [
      mkResult(1, "src/auth/a.ts", "x", 0.9),
      mkResult(2, "src/auth/b.ts", "y", 0.8),
    ];
    const { kept, groupCounts } = groupByDirectory(results);
    expect(kept).toHaveLength(2);
    expect(groupCounts.size).toBe(0);
  });

  it("collapses 3+ tightly-scored results from the same dir", () => {
    const results = [
      mkResult(1, "src/auth/a.ts", "x", 0.90),
      mkResult(2, "src/auth/b.ts", "y", 0.88),
      mkResult(3, "src/auth/c.ts", "z", 0.86),
      mkResult(4, "src/api/d.ts", "q", 0.80),
    ];
    const { kept, groupCounts } = groupByDirectory(results);
    // 3 auth results collapse to 1 hub; api result is untouched.
    expect(kept).toHaveLength(2);
    const hub = kept.find((r) => r.chunk.id === 1);
    expect(hub).toBeTruthy();
    expect(groupCounts.get(1)).toEqual({ count: 2, dir: "src/auth" });
  });

  it("does not collapse when scores are too spread out", () => {
    const results = [
      mkResult(1, "src/auth/a.ts", "x", 0.9),
      mkResult(2, "src/auth/b.ts", "y", 0.4),
      mkResult(3, "src/auth/c.ts", "z", 0.2),
    ];
    const { kept, groupCounts } = groupByDirectory(results);
    expect(kept).toHaveLength(3);
    expect(groupCounts.size).toBe(0);
  });
});

describe("middleTruncate", () => {
  it("returns null for short inputs", () => {
    expect(middleTruncate(["a", "b", "c"], 4, 1)).toBeNull();
  });

  it("elides middle and reports count", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line${i}`);
    const out = middleTruncate(lines, 4, 1);
    expect(out).toBeTruthy();
    expect(out!.head).toHaveLength(4);
    expect(out!.tail).toHaveLength(1);
    expect(out!.elided).toBe(25);
  });
});

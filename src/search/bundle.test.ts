import { describe, it, expect } from "vitest";
import { formatBundle } from "./bundle.js";
import type { BundledHit } from "./bundle.js";
import type { SearchResult, CodeChunk, FileRecord } from "../types/index.js";

function mkChunk(id: number, start: number, end: number, name: string | null = null): CodeChunk {
  return {
    id, file_id: 1, type: "function", name, signature: null,
    start_line: start, end_line: end, content: "body", description: null, token_count: 50,
  };
}

function mkFile(id: number, path: string): FileRecord {
  return {
    id, path, language: "typescript", hash: "h", last_modified: 0,
    size_bytes: 100, pagerank: 0.5, indexed_at: 0,
  };
}

function mkHit(overrides: Partial<BundledHit> = {}): BundledHit {
  const chunk = mkChunk(10, 10, 30, "target");
  const file = mkFile(1, "src/foo.ts");
  const result: SearchResult = { chunk, file, score: 0.5 };
  return {
    result,
    adjacents: [],
    neighbors: [],
    ...overrides,
  };
}

describe("formatBundle", () => {
  it("returns an empty string when nothing to bundle", () => {
    expect(formatBundle(mkHit())).toBe("");
  });

  it("renders adjacent chunks under a section", () => {
    const hit = mkHit({
      adjacents: [mkChunk(11, 40, 60, "next")],
    });
    const out = formatBundle(hit);
    expect(out).toContain("Adjacent in file:");
    expect(out).toContain("src/foo.ts:40-60");
    expect(out).toContain("next");
  });

  it("renders 1-hop neighbors under a separate section", () => {
    const hit = mkHit({
      neighbors: [
        { chunk: mkChunk(20, 1, 10, "Sibling"), file: mkFile(2, "src/bar.ts") },
      ],
    });
    const out = formatBundle(hit);
    expect(out).toContain("Graph neighbors (1-hop):");
    expect(out).toContain("src/bar.ts:1-10");
    expect(out).toContain("Sibling");
  });

  it("renders both sections when both present", () => {
    const hit = mkHit({
      adjacents: [mkChunk(11, 40, 60, "next")],
      neighbors: [{ chunk: mkChunk(20, 1, 10, "Sibling"), file: mkFile(2, "src/bar.ts") }],
    });
    const out = formatBundle(hit);
    expect(out).toContain("Adjacent in file:");
    expect(out).toContain("Graph neighbors (1-hop):");
  });
});

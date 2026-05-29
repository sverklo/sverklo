import { describe, expect, it } from "vitest";
import { buildProveReport, type ProveIndex } from "./prove.js";
import type { FileRecord, CodeChunk } from "./types/index.js";

const file = (id: number, path: string, pagerank: number): FileRecord => ({
  id,
  path,
  language: "typescript",
  hash: `h${id}`,
  last_modified: 1,
  size_bytes: 100,
  pagerank,
  indexed_at: 1,
});

const chunk = (
  id: number,
  file_id: number,
  name: string,
  type: CodeChunk["type"] = "function",
): CodeChunk => ({
  id,
  file_id,
  type,
  name,
  signature: `${name}()`,
  start_line: 10 + id,
  end_line: 20 + id,
  content: `function ${name}() {}`,
  description: null,
  token_count: 5,
});

describe("buildProveReport", () => {
  it("surfaces a real local symbol with callers and a paste-ready prompt", () => {
    const files = [
      file(1, "src/auth/service.ts", 0.9),
      file(2, "src/routes/login.ts", 0.7),
      file(3, "src/routes/session.ts", 0.6),
      file(4, "src/auth/service.test.ts", 0.1),
    ];
    const definition = {
      ...chunk(1, 1, "validateToken"),
      filePath: "src/auth/service.ts",
      pagerank: 0.9,
      fileLanguage: "typescript",
    };

    const indexer: ProveIndex = {
      fileStore: {
        getAll: () => files,
        count: () => files.length,
        getLanguages: () => ["typescript"],
      },
      chunkStore: {
        count: () => 12,
        getByNameWithFile: () => [definition],
        getAllWithFile: () => [definition],
      },
      symbolRefStore: {
        count: () => 42,
        getGodNodeStats: () => [
          { target_name: "validateToken", ref_count: 7, distinct_source_files: 3 },
        ],
        getImpact: () => [
          {
            chunk_id: 2,
            chunk_name: "login",
            chunk_type: "function",
            file_path: "src/routes/login.ts",
            start_line: 12,
            end_line: 20,
            ref_line: 16,
          },
          {
            chunk_id: 3,
            chunk_name: "session",
            chunk_type: "function",
            file_path: "src/routes/session.ts",
            start_line: 22,
            end_line: 30,
            ref_line: 25,
          },
        ],
      },
    };

    const report = buildProveReport(indexer, "/tmp/product");

    expect(report).toContain("sverklo prove - repo memory check");
    expect(report).toContain("validateToken");
    expect(report).toContain("defined at src/auth/service.ts:11");
    expect(report).toContain("referenced 7 times across 3 files");
    expect(report).toContain("Use sverklo impact on validateToken");
    expect(report).not.toContain("service.test.ts");
  });
});

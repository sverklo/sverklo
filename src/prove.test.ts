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
      file(5, "benchmark/auth.ts", 1.0),
      file(6, "playground/vite.config.ts", 1.0),
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
        getByNameWithFile: (name) =>
          name === "resolve"
            ? [{ ...definition, name: "resolve", signature: "resolve()" }]
            : [definition],
        getAllWithFile: () => [definition],
      },
      symbolRefStore: {
        count: () => 42,
        getGodNodeStats: (excluded) => {
          expect(excluded).toEqual(new Set([4, 5, 6]));
          return [
            { target_name: "resolve", ref_count: 20, distinct_source_files: 10 },
            { target_name: "validateToken", ref_count: 7, distinct_source_files: 3 },
          ];
        },
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
          {
            chunk_id: 6,
            chunk_name: "vite.config",
            chunk_type: "block",
            file_path: "playground/vite.config.ts",
            start_line: 1,
            end_line: 5,
            ref_line: 2,
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
    expect(report).toContain("Feedback is optional. You can keep this receipt private.");
    expect(report).toContain(
      "If you choose to share feedback after an invitation, reply in the feedback channel named in that invitation.",
    );
    expect(report).toContain(
      "If no feedback channel was named and you choose to share publicly, use the proof thread:",
    );
    expect(report).toContain("https://github.com/sverklo/sverklo/discussions/79");
    expect(report).toContain(
      "Use a public repo, or redact private file, symbol, caller, and repo identifiers before posting.",
    );
    expect(report).toContain(
      "external-receipt, correction, grep-better, or setup-friction",
    );
    expect(report).not.toMatch(/\bstar(?:ring)?\b/i);
    expect(report).not.toContain("service.test.ts");
    expect(report).not.toContain("benchmark/auth.ts");
    expect(report).not.toContain("playground/vite.config.ts");
  });

  it("can render a shareable markdown receipt", () => {
    const files = [
      file(1, "src/auth/service.ts", 0.9),
      file(2, "src/routes/login.ts", 0.7),
      file(3, "src/routes/session.ts", 0.6),
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

    const report = buildProveReport(indexer, "/tmp/product", { format: "markdown" });

    expect(report).toContain("# Sverklo repo-memory proof: product");
    expect(report).toContain("Generated with `sverklo prove --markdown`.");
    expect(report).toContain("| `src/auth/service.ts` | 0.9000 |");
    expect(report).toContain("`validateToken` is defined at `src/auth/service.ts:11`.");
    expect(report).toContain("```text\nUse sverklo impact on validateToken");
    expect(report).toContain("## Optional feedback");
    expect(report).toContain("You can keep this receipt private.");
    expect(report).toContain(
      "If you choose to share feedback after an invitation, reply in the feedback channel named in that invitation.",
    );
    expect(report).toContain(
      "If no feedback channel was named and you choose to share publicly, use the proof thread:",
    );
    expect(report).toContain(
      "Use a public repo, or redact private file, symbol, caller, and repo identifiers before posting.",
    );
    expect(report).toContain(
      "Outcome: external-receipt | correction | grep-better | setup-friction",
    );
    expect(report).not.toMatch(/\bstar(?:ring)?\b/i);
  });

  it("skips caller graphs with ambiguous symbol definitions", () => {
    const files = [
      file(1, "src/first.ts", 0.9),
      file(2, "src/second.ts", 0.8),
      file(3, "src/config.ts", 0.7),
      file(4, "src/consumer.ts", 0.6),
    ];
    const ambiguousDefinitions = [
      { ...chunk(1, 1, "resolveConfig"), filePath: "src/first.ts", pagerank: 0.9, fileLanguage: "typescript" },
      { ...chunk(2, 2, "resolveConfig"), filePath: "src/second.ts", pagerank: 0.8, fileLanguage: "typescript" },
    ];
    const uniqueDefinition = {
      ...chunk(3, 3, "validateToken"),
      filePath: "src/config.ts",
      pagerank: 0.7,
      fileLanguage: "typescript",
    };

    const indexer: ProveIndex = {
      fileStore: {
        getAll: () => files,
        count: () => files.length,
        getLanguages: () => ["typescript"],
      },
      chunkStore: {
        count: () => 4,
        getByNameWithFile: (name) =>
          name === "resolveConfig" ? ambiguousDefinitions : [uniqueDefinition],
        getAllWithFile: () => [uniqueDefinition],
      },
      symbolRefStore: {
        count: () => 4,
        getGodNodeStats: () => [
          { target_name: "resolveConfig", ref_count: 12, distinct_source_files: 4 },
          { target_name: "validateToken", ref_count: 3, distinct_source_files: 2 },
        ],
        getImpact: (name) => [
          {
            chunk_id: 4,
            chunk_name: "consumer",
            chunk_type: "function",
            file_path: "src/consumer.ts",
            start_line: 1,
            end_line: 5,
            ref_line: 2,
          },
          {
            chunk_id: 3,
            chunk_name: "config",
            chunk_type: "function",
            file_path: "src/config.ts",
            start_line: 1,
            end_line: 5,
            ref_line: 2,
          },
        ],
      },
    };

    const report = buildProveReport(indexer, "/tmp/product");

    expect(report).toContain("validateToken");
    expect(report).not.toContain("Use sverklo impact on resolveConfig");
  });

  it("explains guided no-write trial mode", () => {
    const files = [
      file(1, "src/auth/service.ts", 0.9),
      file(2, "src/routes/login.ts", 0.7),
      file(3, "src/routes/session.ts", 0.6),
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

    const report = buildProveReport(indexer, "/tmp/product", {
      guided: true,
      noWrite: true,
    });

    expect(report).toContain("Trial mode:");
    expect(report).toContain("no project files, MCP configs, or agent instruction files were written");
    expect(report).toContain("Guided proof selection:");
    expect(report).toContain("Selected validateToken because it has a non-test definition");
    expect(report).toContain("sverklo init --dry-run");
  });
});

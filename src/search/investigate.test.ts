import { describe, it, expect } from "vitest";
import { extractSymbolTokens, formatInvestigate, runInvestigate } from "./investigate.js";
import type { InvestigateResult } from "./investigate.js";
import type { CodeChunk, FileRecord } from "../types/index.js";

describe("extractSymbolTokens", () => {
  it("extracts short quoted identifiers and drops stopwords", () => {
    const tokens = extractSymbolTokens("How does authenticate work with tokens?");
    expect(tokens).toContain("authenticate");
    expect(tokens).toContain("tokens");
    expect(tokens).not.toContain("How");
    expect(tokens).not.toContain("with");
    expect(tokens).not.toContain("does");
  });

  it("splits camelCase into parts", () => {
    const tokens = extractSymbolTokens("explain parseMarkdownChunk");
    expect(tokens).toContain("parseMarkdownChunk");
    expect(tokens).toContain("parse");
    expect(tokens).toContain("Markdown");
    expect(tokens).toContain("Chunk");
  });

  it("splits snake_case identifiers", () => {
    const tokens = extractSymbolTokens("what does parse_ast_node do?");
    expect(tokens).toContain("parse_ast_node");
    expect(tokens).toContain("parse");
    expect(tokens).toContain("ast");
    expect(tokens).toContain("node");
  });

  it("caps output at 10 tokens", () => {
    // Cap was bumped from 6 → 10 (v0.15-rc.1) so that domain tokens
    // appearing late in a question ("…exceeds the token budget") aren't
    // dropped before the path retriever gets to use them.
    const tokens = extractSymbolTokens(
      "one two three four five six seven eight nine ten eleven twelve thirteen"
    );
    expect(tokens.length).toBeLessThanOrEqual(10);
  });
});

describe("formatInvestigate", () => {
  function mkResult(): InvestigateResult {
    return {
      query: "token budget",
      hits: [
        {
          chunk: {
            id: 1, file_id: 1, type: "function", name: "resolveBudget",
            signature: null, start_line: 10, end_line: 40,
            content: "// body", description: null, token_count: 50,
          },
          file: {
            id: 1, path: "src/utils/budget.ts", language: "typescript",
            hash: "h", last_modified: 0, size_bytes: 100, pagerank: 0.5, indexed_at: 0,
          },
          score: 0.05,
          found_by: ["fts", "symbol"],
        },
      ],
      budget_used: { fts: 50, vector: 50, symbol: 8, refs: 0, "graph-expand": 0, module: 0, path: 0, upstream: 0 },
    };
  }

  it("renders a hit block with found_by tags", () => {
    const out = formatInvestigate(mkResult());
    expect(out).toContain("Investigation: \"token budget\"");
    expect(out).toContain("src/utils/budget.ts:10-40");
    expect(out).toContain("resolveBudget");
    expect(out).toContain("found by: fts, symbol");
  });

  it("handles no-match case gracefully", () => {
    const empty: InvestigateResult = {
      query: "nothing matches",
      hits: [],
      budget_used: { fts: 0, vector: 0, symbol: 0, refs: 0, "graph-expand": 0, module: 0, path: 0, upstream: 0 },
    };
    const out = formatInvestigate(empty);
    expect(out).toContain("No candidates");
  });
});

describe("runInvestigate — path-definition selection", () => {
  it("keeps later flow functions from an acronym-matched file", async () => {
    const file: FileRecord = {
      id: 1, path: "src/server/hmr.ts", language: "typescript", hash: "h",
      last_modified: 0, size_bytes: 100, pagerank: 0, indexed_at: 0,
    };
    const names = [
      "HmrOptions", "HmrContext", "HotUpdateOptions", "HotChannel", "HmrPayload",
      "handleHMRUpdate", "updateModules", "propagateUpdate", "normalizeHmrUrl",
      "lexAcceptedHmrDeps", "createChannel",
    ];
    const chunks: CodeChunk[] = names.map((name, index) => ({
      id: index + 1, file_id: file.id, type: "function", name, signature: null,
      start_line: (index + 1) * 10, end_line: (index + 1) * 10 + 4,
      content: name, description: null, token_count: 5,
    }));
    const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
    const indexer = {
      fileStore: { getAll: () => [file] },
      chunkStore: {
        searchFts: () => [], getByName: () => [], getByFile: () => chunks,
        getById: (id: number) => byId.get(id),
      },
      symbolRefStore: { getImpact: () => [] },
      embed: async () => [],
    } as never;

    const result = await runInvestigate(indexer, {
      query: "How does HMR change a module after a reload?",
    });

    expect(result.hits.map((hit) => hit.chunk.name)).toEqual(expect.arrayContaining([
      "handleHMRUpdate", "updateModules", "propagateUpdate",
    ]));
    expect(result.hits[0]?.chunk.name).toBe("handleHMRUpdate");
  });
});

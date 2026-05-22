import type { IndexCode } from "../../indexer/index-code.js";
import { formatLookup } from "../../search/token-budget.js";
import type { FileRecord, ChunkType, SearchResult, CodeChunk } from "../../types/index.js";
import { resolveBudget } from "../../utils/budget.js";
import { rerank, rerankerConfigFromEnv } from "../../search/rerank.js";

// Issue #6: on the first call, sverklo_lookup paid a ~1.6s penalty while
// warming up prepared statements via fileStore.getAll() to build a
// pagerank-by-file map. The getByNameWithFile JOIN below returns the
// same shape in a single indexed query, eliminating the full scan.

export const lookupTool = {
  name: "sverklo_lookup",
  description:
    "Look up a specific symbol (function, class, type, variable) by name. Returns its full definition, signature, and location.",
  inputSchema: {
    type: "object" as const,
    properties: {
      symbol: {
        type: "string",
        description: "Symbol name to look up (exact or prefix match)",
      },
      repo: {
        type: "string",
        description:
          "Optional: name of a registered repo to search (see sverklo_list_repos). " +
          "Defaults to the current workspace. Use this to look up a symbol in a sibling " +
          "project that has been sverklo-init'd but isn't the current cwd.",
      },
      type: {
        type: "string",
        enum: [
          "function",
          "class",
          "type",
          "interface",
          "method",
          "variable",
          "any",
        ],
        description: "Filter by symbol type",
      },
      token_budget: {
        type: "number",
        description: "Max tokens to return (default: 2000)",
      },
    },
    required: ["symbol"],
  },
};

export async function handleLookup(
  indexer: IndexCode,
  args: Record<string, unknown>
): Promise<string> {
  // Bug A (issue #15 investigation): missing / wrong-named required
  // params previously fell through to a SQL LIKE '%undefined%' and
  // returned "No results found" — indistinguishable from "the symbol
  // doesn't exist" and actively misleading. Fail loud instead so the
  // caller knows it was their mistake, not the index's.
  const symbol = args.symbol;
  if (typeof symbol !== "string" || symbol.trim() === "") {
    return (
      'Error: `symbol` is required. Usage: sverklo_lookup symbol:"MyClass".\n' +
      "The tool schema names this parameter `symbol`, not `name` — common typo."
    );
  }
  const type = (args.type as ChunkType | "any") || "any";
  const tokenBudget = resolveBudget(args, "lookup", null, 2000);

  // Single JOIN'd query — chunks come back pre-sorted by pagerank DESC
  // and carry the containing file's path, so no full fileStore scan.
  //
  // Issue #29 wiring: when SVERKLO_RERANK is set, we pull a wider
  // candidate pool here (40 vs the default 20) so the reranker has
  // room to reorder. Without rerank, the SQL match-quality + pagerank
  // sort is the final answer; with rerank, MaxSim against query
  // tokens reorders the top of the list.
  const rerankConfig = rerankerConfigFromEnv();
  const rerankActive = rerankConfig.mode !== "off";
  const candidatePool = rerankActive ? 40 : 20;
  let chunks = indexer.chunkStore.getByNameWithFile(symbol, candidatePool);

  if (type !== "any") {
    chunks = chunks.filter((c) => c.type === type);
  }

  // Optional rerank pass. Skipped when mode === "off" (the
  // production default). Per the rerank contract the reranker
  // attaches __rerankScore as a sidecar and does NOT mutate score;
  // we re-sort by sidecar score and continue with the existing
  // formatter. Best-effort: if the rerank fails (no model loaded,
  // budget exceeded), it returns the input unchanged with a single
  // dedup'd warn — same posture as the hybrid-search call site.
  if (rerankActive && chunks.length > 1) {
    const candidates: SearchResult[] = chunks.map((c) => ({
      chunk: c as unknown as CodeChunk,
      file: {
        id: c.file_id,
        path: c.filePath,
        language: c.fileLanguage,
        hash: "",
        last_modified: 0,
        size_bytes: 0,
        pagerank: c.pagerank,
        indexed_at: 0,
      },
      // Synthetic score; the reranker writes its own sidecar and
      // never reads .score, so this stays inert.
      score: 0,
    }));
    const reranked = await rerank(symbol, candidates, {
      ...rerankConfig,
      // Lookup wants more than the default rerank topK (10) because
      // formatLookup truncates by token budget anyway.
      topK: 20,
      candidatePool,
    });
    // Map back to the wider chunk-with-joined-fields shape.
    chunks = reranked.map((r) => r.chunk as unknown as typeof chunks[number]);
  }

  // formatLookup only reads filePath / lang off the file map when the
  // chunk itself doesn't carry filePath. Since our JOIN provides it,
  // we can pass an empty map and avoid the scan.
  const emptyFileMap = new Map<number, FileRecord>();
  return formatLookup(chunks, emptyFileMap, tokenBudget);
}

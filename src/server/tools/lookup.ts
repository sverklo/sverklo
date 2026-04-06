import type { Indexer } from "../../indexer/indexer.js";
import { formatLookup } from "../../search/token-budget.js";
import type { FileRecord, ChunkType } from "../../types/index.js";

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

export function handleLookup(
  indexer: Indexer,
  args: Record<string, unknown>
): string {
  const symbol = args.symbol as string;
  const type = (args.type as ChunkType | "any") || "any";
  const tokenBudget = (args.token_budget as number) || 2000;

  let chunks = indexer.chunkStore.getByName(symbol, 20);

  if (type !== "any") {
    chunks = chunks.filter((c) => c.type === type);
  }

  // Get file data for PageRank ordering
  const fileCache = new Map<number, FileRecord>();
  for (const f of indexer.fileStore.getAll()) {
    fileCache.set(f.id, f);
  }

  // Sort by PageRank of containing file
  chunks.sort((a, b) => {
    const fa = fileCache.get(a.file_id);
    const fb = fileCache.get(b.file_id);
    return (fb?.pagerank || 0) - (fa?.pagerank || 0);
  });

  return formatLookup(chunks, fileCache, tokenBudget);
}

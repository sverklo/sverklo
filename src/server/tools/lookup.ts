import type { Indexer } from "../../indexer/indexer.js";
import { formatLookup } from "../../search/token-budget.js";
import type { FileRecord, ChunkType } from "../../types/index.js";

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
        description: "Max tokens to return (default: 1200)",
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
  const tokenBudget = (args.token_budget as number) || 1200;

  // Single JOIN'd query — chunks come back pre-sorted by pagerank DESC
  // and carry the containing file's path, so no full fileStore scan.
  let chunks = indexer.chunkStore.getByNameWithFile(symbol, 20);

  if (type !== "any") {
    chunks = chunks.filter((c) => c.type === type);
  }

  // formatLookup only reads filePath / lang off the file map when the
  // chunk itself doesn't carry filePath. Since our JOIN provides it,
  // we can pass an empty map and avoid the scan.
  const emptyFileMap = new Map<number, FileRecord>();
  return formatLookup(chunks, emptyFileMap, tokenBudget);
}

import type { Indexer } from "../../indexer/indexer.js";
import { hybridSearch, formatResults } from "../../search/hybrid-search.js";
import type { ChunkType } from "../../types/index.js";

export const searchTool = {
  name: "sverklo_search",
  description:
    "Hybrid semantic + text search with PageRank ranking. Best for exploratory questions where you don't know the exact symbol — 'how does auth work', 'find anything related to billing', 'where's the retry logic'. For exact string matches, prefer Grep.",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "Natural language query or code pattern",
      },
      token_budget: {
        type: "number",
        description: "Max tokens to return (default: 2000)",
      },
      scope: {
        type: "string",
        description: "Limit to path prefix, e.g. 'src/api/'",
      },
      language: {
        type: "string",
        description: "Filter by language, e.g. 'typescript'",
      },
      type: {
        type: "string",
        enum: ["function", "class", "type", "interface", "method", "any"],
        description: "Filter by symbol type (default: any)",
      },
    },
    required: ["query"],
  },
};

export async function handleSearch(
  indexer: Indexer,
  args: Record<string, unknown>
): Promise<string> {
  const results = await hybridSearch(indexer, {
    query: args.query as string,
    tokenBudget: (args.token_budget as number) || 2000,
    scope: args.scope as string | undefined,
    language: args.language as string | undefined,
    type: (args.type as ChunkType | "any") || "any",
  });

  return formatResults(results);
}

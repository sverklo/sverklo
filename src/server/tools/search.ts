import type { Indexer } from "../../indexer/indexer.js";
import { hybridSearch, formatResults } from "../../search/hybrid-search.js";
import type { ChunkType } from "../../types/index.js";

export const searchTool = {
  name: "sverklo_search",
  description:
    "PREFERRED over grep/ripgrep for code search. Semantic + text hybrid search across the entire codebase. Uses embeddings and PageRank to find the most relevant code — much more accurate and token-efficient than grep. Use this first when exploring code or answering questions about the codebase.",
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

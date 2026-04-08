import type { Indexer } from "../../indexer/indexer.js";
import { hybridSearchWithConfidence, formatResults } from "../../search/hybrid-search.js";
import type { ChunkType } from "../../types/index.js";

export const searchTool = {
  name: "sverklo_search",
  description:
    "Hybrid semantic + text search with PageRank ranking. " +
    "WORKS WELL for: exploratory questions where you don't know the exact symbol " +
    "('how does auth work', 'find anything related to billing', 'where's the retry " +
    "logic'), anti-pattern discovery ('swallowed exceptions', 'silent null returns'), " +
    "and cross-file semantic matches. " +
    "STRUGGLES WITH: framework registration and wiring questions ('how is X " +
    "registered as a bean', 'where is this interceptor configured'). For those, " +
    "grep the specific annotation (@Component, @Configuration, etc.) directly. " +
    "Response includes a confidence signal and a fallback hint when the query " +
    "shape is one we know semantic search handles poorly.",
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
  const response = await hybridSearchWithConfidence(indexer, {
    query: args.query as string,
    tokenBudget: (args.token_budget as number) || 2000,
    scope: args.scope as string | undefined,
    language: args.language as string | undefined,
    type: (args.type as ChunkType | "any") || "any",
  });

  const body = formatResults(response.results);

  // Confidence footer — issue #4. Keep it terse and only attach
  // advisory text when there's something actionable to say. High-
  // confidence results don't need a footer at all.
  const footerLines: string[] = [];
  if (response.confidence === "low") {
    footerLines.push("");
    footerLines.push(`**⚠️ Low confidence** — ${response.confidenceReason ?? "weak ranking"}`);
    if (response.fallbackHint) footerLines.push(response.fallbackHint);
  } else if (response.confidence === "medium" && response.fallbackHint) {
    footerLines.push("");
    footerLines.push(`_Medium confidence — ${response.confidenceReason ?? "mixed ranking"}_`);
    footerLines.push(response.fallbackHint);
  }

  return body + (footerLines.length > 0 ? "\n" + footerLines.join("\n") : "");
}

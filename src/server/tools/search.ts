import type { Indexer } from "../../indexer/indexer.js";
import { hybridSearchWithConfidence, formatResults } from "../../search/hybrid-search.js";
import type { ChunkType } from "../../types/index.js";
import { resolveBudget } from "../../utils/budget.js";

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
        description: "Max tokens to return (default: 4000)",
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
      current_file: {
        type: "string",
        description:
          "Optional: repo-relative path of the file the user is currently editing. " +
          "When provided, results closer to this file (in directory distance) get a " +
          "small ranking boost — useful for breaking ties between equally-relevant " +
          "candidates.",
      },
    },
    required: ["query"],
  },
};

export async function handleSearch(
  indexer: Indexer,
  args: Record<string, unknown>
): Promise<string> {
  const tokenBudget = resolveBudget(args, "search", null, 4000);
  const response = await hybridSearchWithConfidence(indexer, {
    query: args.query as string,
    tokenBudget,
    scope: args.scope as string | undefined,
    language: args.language as string | undefined,
    type: (args.type as ChunkType | "any") || "any",
    currentFile: args.current_file as string | undefined,
  });

  const body = formatResults(response.results);

  // Confidence footer — issue #4. Keep it terse and only attach
  // advisory text when there's something actionable to say. High-
  // confidence results don't need a footer at all.
  const footerLines: string[] = [];
  if (response.confidence === "low") {
    footerLines.push("");
    footerLines.push(`⚠ low conf: ${response.confidenceReason ?? "weak ranking"}`);
    if (response.fallbackHint) footerLines.push(response.fallbackHint);
  } else if (response.confidence === "medium" && response.fallbackHint) {
    footerLines.push("");
    footerLines.push(`_med conf: ${response.confidenceReason ?? "mixed"}_`);
    footerLines.push(response.fallbackHint);
  }

  return body + (footerLines.length > 0 ? "\n" + footerLines.join("\n") : "");
}

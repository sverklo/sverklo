import type { Indexer } from "../../indexer/indexer.js";
import { hybridSearchWithConfidence, formatResults } from "../../search/hybrid-search.js";
import type { SearchResult } from "../../types/index.js";
import { bundleResults, formatBundle } from "../../search/bundle.js";
import { emitForHits } from "../../memory/evidence-emit.js";
import type { ChunkType } from "../../types/index.js";
import { resolveBudget } from "../../utils/budget.js";
import { validateEnum, requireString } from "./_validation.js";

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
      format: {
        type: "string",
        enum: ["compact", "full"],
        description:
          "compact (default) elides long bodies, dedups similar chunks, and groups " +
          "3+ results from the same directory into a hub+count. full returns every " +
          "match with complete bodies — use when the agent needs to see everything.",
      },
      bundle_tokens: {
        type: "number",
        description:
          "When > 0, attaches up to this many extra tokens of context to the response: " +
          "adjacent chunks in the same file + 1-hop import-graph neighbors. " +
          "Useful for onboarding or 'show me more' flows; defaults to 0 (off).",
      },
      mode: {
        type: "string",
        enum: ["refs", "full"],
        description:
          "refs returns hits without bodies (file:line + score + name) — same latency as " +
          "full, ~half the payload tokens. full (default) returns the same hits with " +
          "their bodies. Borrowed from iwe-org/iwe's find/retrieve split; use refs when " +
          "you only need to triage the hit list and intend to follow up with ctx_slice " +
          "on a specific hit.",
      },
    },
    required: ["query"],
  },
};

export async function handleSearch(
  indexer: Indexer,
  args: Record<string, unknown>
): Promise<string> {
  const queryArg = requireString(
    args.query,
    "query",
    'sverklo_search query:"how does retry logic work" [scope:src/api/] [type:function] [mode:refs|full]'
  );
  if (!queryArg.ok) return queryArg.message;
  const mode = validateEnum(args.mode, ["refs", "full"], "mode", "full");
  if (mode instanceof Error) return `Error: ${mode.message}`;
  const format = validateEnum(args.format, ["compact", "full"], "format", "compact");
  if (format instanceof Error) return `Error: ${format.message}`;

  const tokenBudget = resolveBudget(args, "search", null, 4000);
  const response = await hybridSearchWithConfidence(indexer, {
    query: queryArg.value,
    tokenBudget,
    scope: args.scope as string | undefined,
    language: args.language as string | undefined,
    type: (args.type as ChunkType | "any") || "any",
    currentFile: args.current_file as string | undefined,
  });
  let body =
    mode === "refs"
      ? formatRefsOnly(response.results)
      : formatResults(response.results, { format });

  // P1-13: optional context bundling. Appends an "Extra context" appendix
  // when the caller asked for it, leaving the main ranked body unchanged.
  const bundleTokens = typeof args.bundle_tokens === "number" ? args.bundle_tokens : 0;
  if (bundleTokens > 0 && response.results.length > 0) {
    const { bundled, tokensUsed, tokensBudget } = bundleResults(
      indexer,
      response.results,
      { tokenBudget: bundleTokens }
    );
    const sections: string[] = [];
    for (const hit of bundled) {
      const block = formatBundle(hit);
      if (!block.trim()) continue;
      const header = `### ${hit.result.file.path}:${hit.result.chunk.start_line}-${hit.result.chunk.end_line}`;
      sections.push(header + block);
    }
    if (sections.length > 0) {
      body +=
        `\n\n## Extra context (${tokensUsed}/${tokensBudget} tokens used)\n` +
        sections.join("\n\n");
    }
  }

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

  // Q4: per-hit Evidence rows. Each result gets its own ev_ id the agent
  // can verify with sverklo_verify. Capped at 16 to keep the footer
  // bounded; oversize result sets get evidence for their top entries.
  const { footer: evidenceFooter } = emitForHits(
    indexer,
    response.results,
    "fts",
    16
  );

  return (
    body +
    (footerLines.length > 0 ? "\n" + footerLines.join("\n") : "") +
    evidenceFooter
  );
}

function formatRefsOnly(results: SearchResult[]): string {
  if (results.length === 0) return "No matches.";
  const lines: string[] = [];
  for (const { chunk, file, score } of results) {
    const name = chunk.name ? ` ${chunk.type}:${chunk.name}` : ` ${chunk.type}`;
    lines.push(
      `${file.path}:${chunk.start_line}-${chunk.end_line}${name} · score ${score.toFixed(3)}`
    );
  }
  lines.push("");
  lines.push(
    `_${results.length} ref(s). Re-run with mode:"full" or use sverklo_ctx_slice for bodies._`
  );
  return lines.join("\n");
}

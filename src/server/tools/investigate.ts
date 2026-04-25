import type { Indexer } from "../../indexer/indexer.js";
import { runInvestigate, formatInvestigate } from "../../search/investigate.js";
import { emitForHits } from "../../memory/evidence-emit.js";

export const investigateTool = {
  name: "sverklo_investigate",
  description:
    "Single-call research primitive: fans out to BM25, embeddings, symbol lookup, and " +
    "reference-expansion in parallel; RRF-fuses the candidates; returns one ranked bundle " +
    "with per-hit provenance (which retriever(s) found it). Cheaper than running " +
    "sverklo_search + sverklo_refs + sverklo_lookup back-to-back. WORKS WELL for open-ended " +
    "questions where you don't yet know whether the answer lives in code, callers, or " +
    "documentation — the `found_by` tags tell you which signal agreed. Use sverklo_search " +
    "instead when you already know you want pure text/semantic retrieval.",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "Natural-language question or exploration target.",
      },
      scope: {
        type: "string",
        description: "Optional path prefix to limit all retrievers to, e.g. 'src/api/'.",
      },
      budget: {
        type: "number",
        description:
          "Max candidates per sub-retriever (default 50). Higher = broader fusion at " +
          "some latency cost.",
      },
      max_hits: {
        type: "number",
        description: "Max hits to display in the response (default 10).",
      },
      expand_graph: {
        type: "boolean",
        description:
          "Run a 5th retriever that expands top hits one hop along typed edges " +
          "(calls/documents/imports/extends). Improves recall on multi-hop questions " +
          "at small latency cost. Default false.",
      },
    },
    required: ["query"],
  },
};

export async function handleInvestigate(
  indexer: Indexer,
  args: Record<string, unknown>
): Promise<string> {
  const query = args.query as string;
  if (!query || typeof query !== "string") {
    return "sverklo_investigate requires a `query` string.";
  }
  const scope = args.scope as string | undefined;
  const budget = typeof args.budget === "number" ? args.budget : undefined;
  const maxHits = typeof args.max_hits === "number" ? args.max_hits : 10;

  const expandGraph = args.expand_graph === true;
  const result = await runInvestigate(indexer, { query, scope, budget, expandGraph });
  const body = formatInvestigate(result, maxHits);
  // Q4: per-hit evidence. Cap at maxHits so the footer matches what the
  // agent actually sees rendered.
  const { footer } = emitForHits(
    indexer,
    result.hits.slice(0, maxHits).map((h) => ({ chunk: h.chunk, file: h.file, score: h.score })),
    "investigate",
    Math.min(maxHits, 16)
  );
  return body + footer;
}

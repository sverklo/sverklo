import type { Indexer } from "../../indexer/indexer.js";
import { runInvestigate } from "../../search/investigate.js";
import { cosineSimilarity } from "../../indexer/embedder.js";

// P1-15: thin natural-language router. Composes existing primitives —
// concepts (P1-7) → investigate (P0-2) → refs / impact (existing) — to
// answer "where does X live?" questions in one tool call without a
// dedicated retrieval path. Pure composition: zero new ranking logic
// and zero hallucination surface (the answer is always evidence + hits,
// never generated prose).

export const askTool = {
  name: "sverklo_ask",
  description:
    "Natural-language router over sverklo's existing primitives. " +
    "Maps a question to (a) the closest concept (if the concept index exists), " +
    "(b) an investigate fan-out, and (c) refs/impact on the top symbols surfaced. " +
    "Returns a structured answer with evidence — no generated prose. Use when you " +
    "want a single keystroke that exercises the whole stack; for fine-grained " +
    "control prefer sverklo_search / sverklo_investigate / sverklo_refs.",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: { type: "string", description: "Natural-language question." },
      scope: { type: "string", description: "Optional path prefix." },
      mode: {
        type: "string",
        enum: ["fast", "thorough"],
        description:
          "fast (default): one investigate pass + concept lookup. thorough: also " +
          "expand-graph + a refs probe on top symbols.",
      },
    },
    required: ["query"],
  },
};

export async function handleAsk(
  indexer: Indexer,
  args: Record<string, unknown>
): Promise<string> {
  const query = args.query;
  if (typeof query !== "string" || query.trim() === "") {
    return "sverklo_ask requires a non-empty `query`.";
  }
  const scope = args.scope as string | undefined;
  const mode = (args.mode as "fast" | "thorough" | undefined) ?? "fast";

  const lines: string[] = [];
  lines.push(`# ${query}`);
  lines.push("");

  // 1. Concept lookup — only when the index exists.
  const conceptHits = await topConcepts(indexer, query, 3);
  if (conceptHits.length > 0) {
    lines.push("## Closest concepts");
    for (const c of conceptHits) {
      lines.push(`- **${c.label}** _(sim ${c.score.toFixed(3)})_${c.summary ? `: ${c.summary}` : ""}`);
      if (c.hub_file) lines.push(`  - hub: \`${c.hub_file}\``);
    }
    lines.push("");
  }

  // 2. Investigate — always.
  const inv = await runInvestigate(indexer, {
    query,
    scope,
    budget: 50,
    expandGraph: mode === "thorough",
  });

  lines.push(`## Top results (${Math.min(8, inv.hits.length)} of ${inv.hits.length})`);
  for (let i = 0; i < Math.min(8, inv.hits.length); i++) {
    const h = inv.hits[i];
    const name = h.chunk.name ? `: ${h.chunk.name}` : "";
    lines.push(
      `${i + 1}. \`${h.file.path}:${h.chunk.start_line}-${h.chunk.end_line}\` [${h.chunk.type}${name}] · ${h.found_by.join(",")}`
    );
  }
  lines.push("");

  // 3. Thorough mode: refs probe on the most-cited symbol.
  if (mode === "thorough" && inv.hits.length > 0) {
    const symbolCounts = new Map<string, number>();
    for (const h of inv.hits.slice(0, 10)) {
      if (h.chunk.name) {
        symbolCounts.set(h.chunk.name, (symbolCounts.get(h.chunk.name) ?? 0) + 1);
      }
    }
    const topSymbol = [...symbolCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (topSymbol) {
      const callerCount = indexer.symbolRefStore.getCallerCount(topSymbol);
      lines.push(`## Likely entry symbol: \`${topSymbol}\` — ${callerCount} caller(s)`);
      lines.push(`_Drill in: \`sverklo_impact symbol:"${topSymbol}"\` for the full caller graph._`);
      lines.push("");
    }
  }

  lines.push(
    `_Mode: ${mode}. Drill in: \`sverklo_investigate query:"${query}"\` for the raw fan-out, or \`sverklo_search_iterative\` for a wider pool with refinement hints._`
  );

  return lines.join("\n");
}

async function topConcepts(
  indexer: Indexer,
  query: string,
  n: number
): Promise<Array<{ label: string; summary: string | null; hub_file: string | null; score: number }>> {
  let total = 0;
  try {
    total = indexer.conceptStore.count();
  } catch {
    return [];
  }
  if (total === 0) return [];

  const [qVec] = await indexer.embed([query]);
  if (!qVec) return [];

  const scored: Array<{ label: string; summary: string | null; hub_file: string | null; score: number }> = [];
  const embeds = indexer.conceptStore.getAllEmbeddings();
  for (const [cId, vec] of embeds) {
    const c = indexer.conceptStore.get(cId);
    if (!c) continue;
    scored.push({
      label: c.label,
      summary: c.summary,
      hub_file: c.hub_file,
      score: cosineSimilarity(qVec, vec),
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.filter((s) => s.score >= 0.2).slice(0, n);
}

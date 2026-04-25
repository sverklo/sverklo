import type { Indexer } from "../../indexer/indexer.js";
import { runInvestigate, formatInvestigate } from "../../search/investigate.js";
import { buildHandleUri } from "../../storage/handle-store.js";
import { getGitState } from "../../memory/git-state.js";

// Iterative widened-pool search (v0.15, P1-14). Where sverklo_search returns
// the top ~10 hits packed into a token budget, search_iterative widens the
// pool to ~200, stores the body behind a ctx:// handle, and surfaces
// query-refinement hints (top co-occurring symbols, dominant directories,
// concept overlap). The host agent uses ctx_grep / ctx_slice to refine
// without rerunning retrieval.

export const searchIterativeTool = {
  name: "sverklo_search_iterative",
  description:
    "Wider-pool, iterative-friendly variant of sverklo_search. Returns a ctx:// handle to the " +
    "top-200 candidate pool plus refinement hints (co-occurring symbols, dominant directories, " +
    "concept overlap). Use ctx_grep / ctx_slice to refine without firing another retrieval. " +
    "Worth the extra latency (~50ms) on hard multi-hop questions; for single-shot lookups " +
    "use sverklo_search.",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: { type: "string" },
      scope: { type: "string", description: "Optional path prefix." },
      pool: {
        type: "number",
        description: "Candidate pool size (default 200). Capped at 500.",
      },
    },
    required: ["query"],
  },
};

export async function handleSearchIterative(
  indexer: Indexer,
  args: Record<string, unknown>
): Promise<string> {
  const query = args.query;
  if (typeof query !== "string" || query.trim() === "") {
    return "search_iterative requires a non-empty `query`.";
  }
  const scope = args.scope as string | undefined;
  const poolArg = typeof args.pool === "number" ? args.pool : 200;
  const budget = Math.min(500, Math.max(50, poolArg));

  // Always expand graph for iterative search — extra ranker is the point.
  const result = await runInvestigate(indexer, {
    query,
    scope,
    budget,
    expandGraph: true,
  });

  // Format the body the agent will hold via the handle.
  const fullBody = formatInvestigate(result, result.hits.length);

  // Compute refinement hints from the top-30 hits.
  const top = result.hits.slice(0, 30);
  const symbolCounts = new Map<string, number>();
  const dirCounts = new Map<string, number>();
  for (const h of top) {
    if (h.chunk.name) {
      symbolCounts.set(h.chunk.name, (symbolCounts.get(h.chunk.name) ?? 0) + 1);
    }
    const dir = topDir(h.file.path);
    dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
  }

  const topSymbols = [...symbolCounts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const topDirs = [...dirCounts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Concept overlap (only when concept index exists).
  const conceptHints: Array<{ label: string; score: number }> = [];
  try {
    const concepts = indexer.conceptStore.getAll();
    if (concepts.length > 0) {
      const [qVec] = await indexer.embed([query]);
      if (qVec) {
        const { cosineSimilarity } = await import("../../indexer/embedder.js");
        const embeds = indexer.conceptStore.getAllEmbeddings();
        const scored: Array<{ label: string; score: number }> = [];
        for (const [cId, vec] of embeds) {
          const concept = indexer.conceptStore.get(cId);
          if (!concept) continue;
          scored.push({ label: concept.label, score: cosineSimilarity(qVec, vec) });
        }
        scored.sort((a, b) => b.score - a.score);
        conceptHints.push(...scored.slice(0, 3));
      }
    }
  } catch { /* concepts table absent — skip */ }

  // Persist the body as a ctx:// handle.
  const sha = getGitState(indexer.rootPath).sha;
  const handle = indexer.handleStore.create("sverklo_search_iterative", fullBody, sha);
  const uri = buildHandleUri("sverklo_search_iterative", handle.id);

  // Build the response: a short summary + hints + handle URI.
  const lines: string[] = [];
  lines.push(`## Iterative search: "${query}" — ${result.hits.length} candidates`);
  lines.push("");
  lines.push(`Handle: ${uri}`);
  lines.push("");

  // Show top 5 hits inline as a teaser.
  lines.push("### Top 5 (use ctx_slice for the full pool)");
  for (let i = 0; i < Math.min(5, result.hits.length); i++) {
    const h = result.hits[i];
    const name = h.chunk.name ? `: ${h.chunk.name}` : "";
    lines.push(
      `${i + 1}. ${h.file.path}:${h.chunk.start_line}-${h.chunk.end_line} [${h.chunk.type}${name}] · score ${h.score.toFixed(3)} · ${h.found_by.join(",")}`
    );
  }
  lines.push("");

  if (topSymbols.length > 0) {
    lines.push("### Refinement: co-occurring symbols");
    for (const [sym, n] of topSymbols) {
      lines.push(`- \`${sym}\` (${n}× in pool) — try \`sverklo_lookup symbol:"${sym}"\``);
    }
    lines.push("");
  }

  if (topDirs.length > 0) {
    lines.push("### Refinement: dominant directories");
    for (const [dir, n] of topDirs) {
      lines.push(`- \`${dir}/\` (${n} hits) — try \`scope:"${dir}/"\``);
    }
    lines.push("");
  }

  if (conceptHints.length > 0) {
    lines.push("### Refinement: nearest concepts");
    for (const c of conceptHints) {
      lines.push(`- ${c.label} (sim ${c.score.toFixed(3)}) — try \`sverklo_concepts query:"${c.label}"\``);
    }
    lines.push("");
  }

  lines.push(
    `_Drill in: \`sverklo_ctx_grep uri:"${uri}" pattern:"<regex>"\`, \`sverklo_ctx_slice uri:"${uri}" offset:0 length:4000\`._`
  );

  return lines.join("\n");
}

function topDir(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 2) return parts[0] ?? ".";
  return parts.slice(0, 2).join("/");
}

import type { Indexer } from "../../indexer/indexer.js";
import { cosineSimilarity } from "../../indexer/embedder.js";

export const conceptsTool = {
  name: "sverklo_concepts",
  description:
    "Semantic search over LLM-labeled subsystem concepts. Returns the clusters " +
    "whose label/summary best matches the query, along with each cluster's hub file. " +
    "Requires the concept index to have been built: run `sverklo concept-index` once " +
    "per repo. If no index exists, returns a helpful bootstrapping message.",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description:
          "Natural-language question: 'where does caching live?', 'show me the auth subsystem', etc.",
      },
      limit: {
        type: "number",
        description: "Max concepts to return (default 5).",
      },
    },
    required: ["query"],
  },
};

export async function handleConcepts(
  indexer: Indexer,
  args: Record<string, unknown>
): Promise<string> {
  const query = args.query;
  if (typeof query !== "string" || query.trim() === "") {
    return "sverklo_concepts requires a non-empty `query` string.";
  }
  const limit = typeof args.limit === "number" ? args.limit : 5;

  const concepts = indexer.conceptStore.getAll();
  if (concepts.length === 0) {
    return [
      "## Concept index not built",
      "",
      "Run `sverklo concept-index` once per repo to populate this layer. Requires an Ollama",
      "install with a chat-capable model (default: qwen2.5-coder:7b). If you don't have",
      "Ollama yet: https://ollama.com — then `ollama pull qwen2.5-coder:7b`.",
      "",
      "Until then, use `sverklo_clusters` for the raw, unlabeled cluster list.",
    ].join("\n");
  }

  const [qVec] = await indexer.embed([query]);
  if (!qVec) {
    return "Embedding the query failed. Retry, or fall back to sverklo_search.";
  }

  const embeddings = indexer.conceptStore.getAllEmbeddings();
  const scored: Array<{ cluster_id: number; score: number }> = [];
  for (const [clusterId, vec] of embeddings) {
    scored.push({ cluster_id: clusterId, score: cosineSimilarity(qVec, vec) });
  }
  scored.sort((a, b) => b.score - a.score);

  const parts: string[] = [];
  parts.push(`## Concepts for "${query}"`);
  parts.push("");

  const top = scored.slice(0, limit);
  if (top.length === 0 || top[0].score < 0.15) {
    parts.push(
      `No concept scored above 0.15 cosine similarity. Top candidate: ${top[0]?.score.toFixed(3) ?? "n/a"}.`
    );
    parts.push(
      "Try a broader phrasing, or use `sverklo_investigate` — it fans out across multiple retrievers."
    );
    return parts.join("\n");
  }

  for (const { cluster_id, score } of top) {
    const record = indexer.conceptStore.get(cluster_id);
    if (!record) continue;
    parts.push(`### ${record.label}  _score ${score.toFixed(3)}_`);
    if (record.summary) parts.push(record.summary);
    if (record.tags) parts.push(`_tags: ${record.tags}_`);
    parts.push(`_hub: ${record.hub_file ?? "(none)"} · ${record.member_count} files_`);
    parts.push("");
  }

  parts.push("_Use `sverklo_lookup` or `sverklo_refs` on the hub file's exported symbols to drill in._");
  return parts.join("\n");
}

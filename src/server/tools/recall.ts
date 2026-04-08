import type { Indexer } from "../../indexer/indexer.js";
import { embed, cosineSimilarity } from "../../indexer/embedder.js";
import { checkStaleness } from "../../memory/staleness.js";
import { track } from "../../telemetry/index.js";
import type { Memory, MemoryCategory } from "../../types/index.js";

const RRF_K = 60;

export const recallTool = {
  name: "sverklo_recall",
  description:
    "Search memories semantically. Finds past decisions, preferences, and patterns relevant to a query.",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "What to search for in memories",
      },
      category: {
        type: "string",
        enum: ["decision", "preference", "pattern", "context", "todo", "procedural", "any"],
        description: "Filter by category (default: 'any')",
      },
      limit: {
        type: "number",
        description: "Max memories to return (default: 10)",
      },
      include_stale: {
        type: "boolean",
        description: "Include stale memories (default: false)",
      },
    },
    required: ["query"],
  },
};

export async function handleRecall(
  indexer: Indexer,
  args: Record<string, unknown>
): Promise<string> {
  const query = args.query as string;
  const category = (args.category as MemoryCategory | "any") || "any";
  const limit = (args.limit as number) || 10;
  const includeStale = (args.include_stale as boolean) || false;

  // Signal A: FTS text search
  const ftsResults = indexer.memoryStore.searchFts(query, 30);

  // Signal B: Vector similarity
  const [queryVector] = await embed([query]);
  const allEmbeddings = indexer.memoryEmbeddingStore.getAll();
  const vectorScores: { memoryId: number; score: number }[] = [];

  for (const [memoryId, vec] of allEmbeddings) {
    vectorScores.push({ memoryId, score: cosineSimilarity(queryVector, vec) });
  }
  vectorScores.sort((a, b) => b.score - a.score);
  const topVector = vectorScores.slice(0, 30);

  // RRF fusion
  const rrfScores = new Map<number, number>();

  for (let rank = 0; rank < ftsResults.length; rank++) {
    const id = ftsResults[rank].id;
    rrfScores.set(id, (rrfScores.get(id) || 0) + 1 / (RRF_K + rank + 1));
  }

  for (let rank = 0; rank < topVector.length; rank++) {
    const id = topVector[rank].memoryId;
    rrfScores.set(id, (rrfScores.get(id) || 0) + 1 / (RRF_K + rank + 1));
  }

  // Score, filter, sort
  const candidates: { memory: Memory; score: number }[] = [];
  let staleSeen = 0;

  for (const [memoryId, rrfScore] of rrfScores) {
    const memory = indexer.memoryStore.getById(memoryId);
    if (!memory) continue;
    if (category !== "any" && memory.category !== category) continue;

    // Staleness check (lazy)
    const stale = checkStaleness(memory, indexer.fileStore, indexer.memoryStore);
    if (stale) staleSeen++;
    if (stale && !includeStale) continue;

    // Boost by confidence and recency
    const daysSinceAccess = (Date.now() - memory.last_accessed) / 86400000;
    const recencyBoost = 1 / (1 + daysSinceAccess * 0.01);
    const finalScore = rrfScore * memory.confidence * recencyBoost;

    candidates.push({ memory, score: finalScore });
  }

  void track("memory.read");
  if (staleSeen > 0) void track("memory.staleness_detected");

  candidates.sort((a, b) => b.score - a.score);
  const results = candidates.slice(0, limit);

  // Touch access on returned memories
  for (const { memory } of results) {
    indexer.memoryStore.touchAccess(memory.id);
  }

  if (results.length === 0) {
    return "No memories found.";
  }

  // Format
  return results
    .map(({ memory, score }) => {
      const tags = memory.tags ? JSON.parse(memory.tags).join(", ") : "";
      const staleFlag = memory.is_stale ? " [STALE]" : "";
      const git = memory.git_sha
        ? `${memory.git_branch || "?"}@${memory.git_sha.slice(0, 7)}`
        : "";
      const age = formatAge(memory.created_at);

      return [
        `### Memory #${memory.id} (${memory.category})${staleFlag}`,
        memory.content,
        `_${age} ago | confidence: ${memory.confidence} | accessed: ${memory.access_count}x${git ? ` | git: ${git}` : ""}${tags ? ` | tags: ${tags}` : ""}_`,
        "",
      ].join("\n");
    })
    .join("\n");
}

function formatAge(timestamp: number): string {
  const ms = Date.now() - timestamp;
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

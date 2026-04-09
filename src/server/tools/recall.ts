import type { Indexer } from "../../indexer/indexer.js";
import { cosineSimilarity } from "../../indexer/embedder.js";
import { checkStaleness } from "../../memory/staleness.js";
import { track } from "../../telemetry/index.js";
import type { Memory, MemoryCategory, MemoryTier } from "../../types/index.js";

const RRF_K = 60;

// Issue #11: core vs archival memory. Core memories are always-on
// project invariants auto-injected at session start. Archival memories
// are the searchable long tail. The mode parameter lets callers pick:
//
//   - mode=core     → core tier only, returned in priority order
//   - mode=archival → project + archive tiers, full semantic search
//   - mode=all      → default, searches everything
//
// Core tier is soft-capped at 25 memories — LLM context windows don't
// appreciate a 500-line system prompt. Exceeding the cap emits a
// warning in the recall output but does not block writes.
const CORE_TIER_SOFT_LIMIT = 25;

export const recallTool = {
  name: "sverklo_recall",
  description:
    "Search memories semantically. Finds past decisions, preferences, and patterns relevant to a query. " +
    "Supports two specialized modes: `mode=core` returns only the always-on project invariants (fast, " +
    "no query needed — use at session start); `mode=archival` searches the full archive with semantic " +
    "ranking; `mode=all` (default) searches both. Use core for 'what are the project-wide rules I must " +
    "not violate' and archival for 'what did we decide about X on this codebase'.",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "What to search for in memories (optional when mode=core)",
      },
      mode: {
        type: "string",
        enum: ["core", "archival", "all"],
        description:
          "Which memory tier to search. 'core' = always-on invariants only, 'archival' = " +
          "searchable long tail, 'all' = both (default).",
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
  },
};

export async function handleRecall(
  indexer: Indexer,
  args: Record<string, unknown>
): Promise<string> {
  const query = (args.query as string) || "";
  const mode = (args.mode as "core" | "archival" | "all") || "all";
  const category = (args.category as MemoryCategory | "any") || "any";
  const limit = (args.limit as number) || 10;
  const includeStale = (args.include_stale as boolean) || false;

  // Mode: core — return the always-on invariants without semantic
  // ranking. This is the session-start fast path; agents should call
  // this (or read sverklo://context) at the top of every session.
  if (mode === "core") {
    const coreMemories = indexer.memoryStore.getCore(limit);
    const filtered =
      category === "any"
        ? coreMemories
        : coreMemories.filter((m) => m.category === category);

    void track("memory.read");

    if (filtered.length === 0) {
      return (
        "No core memories yet. Core memories are always-on project invariants " +
        "that auto-load each session. Promote an existing memory with " +
        "`sverklo_promote id:<n> tier:core`, or save a new one with " +
        "`sverklo_remember ... tier:core`."
      );
    }

    const parts: string[] = ["# Core memories (always-on project invariants)", ""];
    for (const m of filtered) {
      const staleFlag = m.is_stale ? " [STALE]" : "";
      parts.push(`- **[${m.category}]**${staleFlag} ${m.content}`);
    }
    parts.push("");

    // Soft-limit warning: too many core memories is an anti-pattern.
    const totalCore = indexer.memoryStore.getCore(1000).length;
    if (totalCore > CORE_TIER_SOFT_LIMIT) {
      parts.push(
        `⚠️ ${totalCore} core memories — exceeds the soft limit of ${CORE_TIER_SOFT_LIMIT}. ` +
          "Core memories are injected into every session prompt; too many crowds the context " +
          "window. Demote the least-critical ones with `sverklo_demote id:<n>`."
      );
    }
    return parts.join("\n");
  }

  // Mode: archival | all — full semantic search over the selected
  // tier(s). If the caller passed mode=archival we exclude core; if
  // mode=all we include everything.
  if (!query) {
    return (
      "A `query` is required for archival/all recall. Pass `mode:core` if you want " +
      "to list always-on invariants without a query."
    );
  }

  const excludeTiers: MemoryTier[] = mode === "archival" ? ["core"] : [];

  // Signal A: FTS text search
  const ftsResults = indexer.memoryStore.searchFts(query, 30);

  // Signal B: Vector similarity
  const [queryVector] = await indexer.embed([query]);
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
    if (excludeTiers.includes(memory.tier)) continue;

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

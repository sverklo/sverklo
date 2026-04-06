import type { Indexer } from "../../indexer/indexer.js";
import type { Memory, MemoryCategory } from "../../types/index.js";

export const memoriesTool = {
  name: "memories",
  description:
    "List all memories for the current project. Shows memory health: staleness, confidence, access frequency.",
  inputSchema: {
    type: "object" as const,
    properties: {
      category: {
        type: "string",
        enum: ["decision", "preference", "pattern", "context", "todo", "any"],
        description: "Filter by category (default: 'any')",
      },
      limit: {
        type: "number",
        description: "Max memories to return (default: 50)",
      },
      stale_only: {
        type: "boolean",
        description: "Only show stale memories (default: false)",
      },
    },
  },
};

export function handleMemories(
  indexer: Indexer,
  args: Record<string, unknown>
): string {
  const category = (args.category as MemoryCategory | "any") || "any";
  const limit = (args.limit as number) || 50;
  const staleOnly = (args.stale_only as boolean) || false;

  let memories: Memory[];

  if (staleOnly) {
    memories = indexer.memoryStore.getStale();
  } else if (category !== "any") {
    memories = indexer.memoryStore.getByCategory(category as MemoryCategory, limit);
  } else {
    memories = indexer.memoryStore.getAll(limit);
  }

  if (memories.length === 0) {
    return "No memories stored yet. Use the `remember` tool to save decisions, preferences, and patterns.";
  }

  const total = indexer.memoryStore.count();
  const header = `## Memories (${memories.length}${memories.length < total ? ` of ${total}` : ""})\n`;

  const rows = memories.map((m) => {
    const tags = m.tags ? JSON.parse(m.tags).join(", ") : "";
    const stale = m.is_stale ? " [STALE]" : "";
    const age = formatAge(m.created_at);

    return `- **#${m.id}** [${m.category}]${stale} ${m.content.slice(0, 120)}${m.content.length > 120 ? "..." : ""}\n  _${age} ago | conf: ${m.confidence} | used: ${m.access_count}x${tags ? ` | ${tags}` : ""}_`;
  });

  return header + rows.join("\n\n");
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

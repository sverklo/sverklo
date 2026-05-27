import type { IndexMemory } from "../../indexer/index-memory.js";
import type { Memory, MemoryCategory } from "../../types/index.js";

export const memoriesTool = {
  name: "memories",
  description:
    "List all memories for the current project, or surface conflict candidates. " +
    "Default mode shows memory health (staleness, confidence, access frequency). " +
    "Pass `mode: \"conflicts\"` to surface pairs of active memories that share a pin and may " +
    "contradict — the bi-temporal model preserves both, so this is a review prompt for the " +
    "agent or human, not an auto-resolution.",
  inputSchema: {
    type: "object" as const,
    properties: {
      mode: {
        type: "string",
        enum: ["list", "conflicts"],
        description:
          "list (default): show active memories. conflicts: pairs of active memories sharing " +
          "a pin that may contradict (decision/preference/pattern categories only).",
      },
      category: {
        type: "string",
        enum: ["decision", "preference", "pattern", "context", "todo", "procedural", "any"],
        description: "Filter by category in list mode (default: 'any')",
      },
      limit: {
        type: "number",
        description: "Max memories (list mode) or conflict pairs (conflicts mode) to return (default: 50 / 25)",
      },
      stale_only: {
        type: "boolean",
        description: "List mode: only show stale memories (default: false)",
      },
    },
  },
};

export function handleMemories(
  indexer: IndexMemory,
  args: Record<string, unknown>
): string {
  const mode = (args.mode as "list" | "conflicts" | undefined) || "list";

  if (mode === "conflicts") {
    return formatConflicts(indexer, (args.limit as number) || 25);
  }

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

function formatConflicts(indexer: IndexMemory, limit: number): string {
  const pairs = indexer.memoryStore.findConflicts(limit);
  if (pairs.length === 0) {
    return (
      "No conflict candidates detected. Either there are no active memories sharing a pin, " +
      "or the memories that do share pins are non-contradictory (procedural/context categories " +
      "are excluded by design — they're additive, not contradicting)."
    );
  }

  const out: string[] = [
    `## Memory conflict candidates (${pairs.length})`,
    "",
    "_These are pairs of active memories that share at least one pin and live in a category " +
      "where contradiction is meaningful (decision / preference / pattern). The bi-temporal model " +
      "preserves both — the agent or human picks which to invalidate via `forget` or " +
      "supersede via a fresh `remember` call._",
    "",
  ];

  for (let i = 0; i < pairs.length; i++) {
    const { a, b, sharedPins } = pairs[i];
    const ageA = formatAge(a.created_at);
    const ageB = formatAge(b.created_at);
    out.push(`### ${i + 1}. Shared pins: ${sharedPins.map((p) => `\`${p}\``).join(", ")}`);
    out.push("");
    out.push(`**#${a.id}** [${a.category}] · ${ageA} ago · ${a.valid_from_sha?.slice(0, 7) || "no SHA"}`);
    out.push(`> ${a.content.slice(0, 200)}${a.content.length > 200 ? "…" : ""}`);
    out.push("");
    out.push(`**#${b.id}** [${b.category}] · ${ageB} ago · ${b.valid_from_sha?.slice(0, 7) || "no SHA"}`);
    out.push(`> ${b.content.slice(0, 200)}${b.content.length > 200 ? "…" : ""}`);
    out.push("");
  }

  return out.join("\n");
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

import type { Indexer } from "../../indexer/indexer.js";
import type { MemoryTier } from "../../types/index.js";

export const promoteTool = {
  name: "sverklo_promote",
  description:
    "Promote a memory to the core tier. Core memories are auto-injected into every session " +
    "via sverklo://context resource — use for project invariants that should always be in the " +
    "AI's context (style rules, framework conventions, 'never do X' rules).",
  inputSchema: {
    type: "object" as const,
    properties: {
      id: {
        type: "number",
        description: "Memory ID to promote (from recall/memories results)",
      },
    },
    required: ["id"],
  },
};

export const demoteTool = {
  name: "sverklo_demote",
  description:
    "Demote a memory from core to archive tier. Archive memories are only retrieved on demand " +
    "via sverklo_recall — not automatically injected. Use for memories that no longer need " +
    "to be in every session.",
  inputSchema: {
    type: "object" as const,
    properties: {
      id: {
        type: "number",
        description: "Memory ID to demote",
      },
    },
    required: ["id"],
  },
};

export function handlePromote(indexer: Indexer, args: Record<string, unknown>): string {
  return setTier(indexer, args, "core");
}

export function handleDemote(indexer: Indexer, args: Record<string, unknown>): string {
  return setTier(indexer, args, "archive");
}

function setTier(indexer: Indexer, args: Record<string, unknown>, tier: MemoryTier): string {
  const id = args.id as number;
  const mem = indexer.memoryStore.getById(id);
  if (!mem) return `Memory #${id} not found.`;

  if (mem.tier === tier) {
    return `Memory #${id} is already in ${tier} tier.`;
  }

  indexer.memoryStore.setTier(id, tier);
  return `Moved memory #${id} to ${tier} tier: "${mem.content.slice(0, 80)}${mem.content.length > 80 ? "..." : ""}"`;
}

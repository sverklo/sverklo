import type { Indexer } from "../../indexer/indexer.js";
import type { MemoryTier } from "../../types/index.js";

// Issue #11: soft cap on the core tier. Core memories are injected
// into every session prompt, so bloating this tier costs context-
// window tokens on every agent interaction. Writes above the cap still
// succeed — the cap is advisory — but the tool response warns the
// caller so humans can prune.
const CORE_TIER_SOFT_LIMIT = 25;

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
  // Mirror the tier change to the JSONL journal. Issue #7.
  if (tier === "core") {
    indexer.memoryJournal.promote(id, tier);
  } else {
    indexer.memoryJournal.demote(id, tier);
  }

  const base = `Moved memory #${id} to ${tier} tier: "${mem.content.slice(0, 80)}${mem.content.length > 80 ? "..." : ""}"`;

  // Warn if promoting pushes the core tier over the soft limit.
  if (tier === "core") {
    const coreCount = indexer.memoryStore.getCore(1000).length;
    if (coreCount > CORE_TIER_SOFT_LIMIT) {
      return (
        base +
        `\n\n⚠️ Core tier now has ${coreCount} memories (soft limit: ${CORE_TIER_SOFT_LIMIT}). ` +
        "These are injected into every session prompt — too many crowds the context window. " +
        "Consider demoting the least-critical ones with `sverklo_demote id:<n>`."
      );
    }
  }

  return base;
}

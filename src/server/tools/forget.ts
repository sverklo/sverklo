import type { IndexMemory } from "../../indexer/index-memory.js";

export const forgetTool = {
  name: "forget",
  description:
    "Permanently delete a memory after recall returned a stale or wrong entry. " +
    "Prefer remember (with the new content) over forget+remember when " +
    "superseding a decision — supersession preserves the audit trail via " +
    "valid_until_sha + superseded_by; forget loses it. Get IDs from " +
    "recall or memories.",
  inputSchema: {
    type: "object" as const,
    properties: {
      id: {
        type: "number",
        description: "Memory ID to delete (from recall results)",
      },
    },
    required: ["id"],
  },
};

export function handleForget(
  indexer: IndexMemory,
  args: Record<string, unknown>
): string {
  if (typeof args.id !== "number" || !Number.isInteger(args.id)) {
    return `Error: \`id\` must be an integer, got ${JSON.stringify(args.id)}.`;
  }
  const id = args.id;

  const memory = indexer.memoryStore.getById(id);
  if (!memory) {
    return `Memory #${id} not found.`;
  }

  indexer.memoryStore.delete(id);
  indexer.memoryEmbeddingStore.delete(id);
  // Mirror the delete as a tombstone in the JSONL journal so the
  // journal stays replayable. Issue #7.
  indexer.memoryJournal.forget(id);
  return `Deleted memory #${id} (${memory.category}): "${memory.content.slice(0, 80)}${memory.content.length > 80 ? "..." : ""}"`;
}

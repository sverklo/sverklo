import type { Indexer } from "../../indexer/indexer.js";

export const forgetTool = {
  name: "sverklo_forget",
  description:
    "Permanently delete a memory after recall returned a stale or wrong entry. " +
    "Prefer sverklo_remember (with the new content) over forget+remember when " +
    "superseding a decision — supersession preserves the audit trail via " +
    "valid_until_sha + superseded_by; forget loses it. Get IDs from " +
    "sverklo_recall or sverklo_memories.",
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
  indexer: Indexer,
  args: Record<string, unknown>
): string {
  const id = args.id as number;

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

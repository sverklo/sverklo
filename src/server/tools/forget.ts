import type { Indexer } from "../../indexer/indexer.js";

export const forgetTool = {
  name: "sverklo_forget",
  description: "Remove a memory by ID.",
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
  return `Deleted memory #${id} (${memory.category}): "${memory.content.slice(0, 80)}${memory.content.length > 80 ? "..." : ""}"`;
}

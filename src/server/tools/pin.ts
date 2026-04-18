import type { Indexer } from "../../indexer/indexer.js";

export const pinTool = {
  name: "sverklo_pin",
  description:
    "Pin a memory to a specific file or symbol. Pinned memories surface automatically " +
    "when recalling by that file path or symbol name, without needing semantic search.",
  inputSchema: {
    type: "object" as const,
    properties: {
      memory_id: {
        type: "number",
        description: "Memory ID to pin (from recall/memories results)",
      },
      target: {
        type: "string",
        description: "File path or symbol name to pin the memory to",
      },
    },
    required: ["memory_id", "target"],
  },
};

export const unpinTool = {
  name: "sverklo_unpin",
  description: "Remove a pin from a memory.",
  inputSchema: {
    type: "object" as const,
    properties: {
      memory_id: {
        type: "number",
        description: "Memory ID to unpin",
      },
      target: {
        type: "string",
        description: "File path or symbol name to unpin from",
      },
    },
    required: ["memory_id", "target"],
  },
};

export function handlePin(
  indexer: Indexer,
  args: Record<string, unknown>
): string {
  const memoryId = args.memory_id as number;
  const target = args.target as string;

  const memory = indexer.memoryStore.getById(memoryId);
  if (!memory) {
    return `Memory #${memoryId} not found.`;
  }

  const currentPins: string[] = memory.pins ? JSON.parse(memory.pins) : [];
  if (currentPins.includes(target)) {
    return `Memory #${memoryId} is already pinned to "${target}".`;
  }

  currentPins.push(target);
  indexer.memoryStore.setPins(memoryId, currentPins);

  return `Pinned memory #${memoryId} to "${target}". Pins: [${currentPins.join(", ")}]`;
}

export function handleUnpin(
  indexer: Indexer,
  args: Record<string, unknown>
): string {
  const memoryId = args.memory_id as number;
  const target = args.target as string;

  const memory = indexer.memoryStore.getById(memoryId);
  if (!memory) {
    return `Memory #${memoryId} not found.`;
  }

  const currentPins: string[] = memory.pins ? JSON.parse(memory.pins) : [];
  const idx = currentPins.indexOf(target);
  if (idx === -1) {
    return `Memory #${memoryId} is not pinned to "${target}".`;
  }

  currentPins.splice(idx, 1);
  indexer.memoryStore.setPins(memoryId, currentPins);

  if (currentPins.length === 0) {
    return `Unpinned memory #${memoryId} from "${target}". No remaining pins.`;
  }
  return `Unpinned memory #${memoryId} from "${target}". Remaining pins: [${currentPins.join(", ")}]`;
}

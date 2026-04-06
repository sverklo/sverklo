import type { Memory } from "../types/index.js";
import type { FileStore } from "../storage/file-store.js";
import type { MemoryStore } from "../storage/memory-store.js";

export function checkStaleness(
  memory: Memory,
  fileStore: FileStore,
  memoryStore: MemoryStore
): boolean {
  if (!memory.related_files) return false;

  let files: string[];
  try {
    files = JSON.parse(memory.related_files);
  } catch {
    return false;
  }

  if (!Array.isArray(files) || files.length === 0) return false;

  const anyMissing = files.some((path) => !fileStore.getByPath(path));

  if (anyMissing !== Boolean(memory.is_stale)) {
    memoryStore.markStale(memory.id, anyMissing);
  }

  return anyMissing;
}

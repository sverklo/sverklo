import type { Indexer } from "../../indexer/indexer.js";
import type { FileRecord } from "../../types/index.js";
import { resolveBudget } from "../../utils/budget.js";

export const dependenciesTool = {
  name: "sverklo_deps",
  description:
    "Show what a file imports/depends on and what depends on it. Helps understand the impact of changing a file.",
  inputSchema: {
    type: "object" as const,
    properties: {
      path: {
        type: "string",
        description: "File path to analyze",
      },
      direction: {
        type: "string",
        enum: ["imports", "importers", "both"],
        description: "Direction of dependencies (default: both)",
      },
      depth: {
        type: "number",
        description: "How many levels deep to traverse (default: 1)",
      },
      token_budget: {
        type: "number",
        description: "Max tokens to return (default: 1500)",
      },
    },
    required: ["path"],
  },
};

export function handleDependencies(
  indexer: Indexer,
  args: Record<string, unknown>
): string {
  const path = args.path as string;
  const direction = (args.direction as string) || "both";
  const depth = (args.depth as number) || 1;
  const tokenBudget = resolveBudget(args, "deps", null, 1500);

  const file = indexer.fileStore.getByPath(path);
  if (!file) {
    return `File not found in index: ${path}`;
  }

  const fileCache = new Map<number, FileRecord>();
  for (const f of indexer.fileStore.getAll()) {
    fileCache.set(f.id, f);
  }

  const parts: string[] = [];
  let remaining = tokenBudget;

  parts.push(`## Dependencies for ${path}\n`);
  remaining -= 20;

  if (direction === "imports" || direction === "both") {
    parts.push("### This file imports:");
    remaining -= 10;

    const visited = new Set<number>();
    const queue: { fileId: number; depth: number }[] = [
      { fileId: file.id, depth: 0 },
    ];

    while (queue.length > 0) {
      const { fileId, depth: d } = queue.shift()!;
      if (d >= depth) continue;
      if (visited.has(fileId)) continue;
      visited.add(fileId);

      const deps = indexer.graphStore.getImports(fileId);
      for (const dep of deps) {
        const targetFile = fileCache.get(dep.target_file_id);
        if (!targetFile) continue;

        const indent = "  ".repeat(d + 1);
        const line = `${indent}→ ${targetFile.path} (${dep.reference_count} refs)`;
        const cost = Math.ceil(line.length / 3.5);
        if (remaining < cost) break;

        parts.push(line);
        remaining -= cost;

        if (d + 1 < depth) {
          queue.push({ fileId: dep.target_file_id, depth: d + 1 });
        }
      }
    }

    if (parts[parts.length - 1] === "### This file imports:") {
      parts.push("  (none)");
    }
    parts.push("");
  }

  if (direction === "importers" || direction === "both") {
    parts.push("### Files that import this:");
    remaining -= 10;

    const visited = new Set<number>();
    const queue: { fileId: number; depth: number }[] = [
      { fileId: file.id, depth: 0 },
    ];

    while (queue.length > 0) {
      const { fileId, depth: d } = queue.shift()!;
      if (d >= depth) continue;
      if (visited.has(fileId)) continue;
      visited.add(fileId);

      const importers = indexer.graphStore.getImporters(fileId);
      for (const imp of importers) {
        const sourceFile = fileCache.get(imp.source_file_id);
        if (!sourceFile) continue;

        const indent = "  ".repeat(d + 1);
        const line = `${indent}← ${sourceFile.path} (${imp.reference_count} refs)`;
        const cost = Math.ceil(line.length / 3.5);
        if (remaining < cost) break;

        parts.push(line);
        remaining -= cost;

        if (d + 1 < depth) {
          queue.push({ fileId: imp.source_file_id, depth: d + 1 });
        }
      }
    }

    if (parts[parts.length - 1] === "### Files that import this:") {
      parts.push("  (none)");
    }
  }

  return parts.join("\n");
}

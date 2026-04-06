import type { FileRecord, CodeChunk } from "../types/index.js";

export interface OverviewEntry {
  file: FileRecord;
  chunks: CodeChunk[];
}

export function formatOverview(
  entries: OverviewEntry[],
  tokenBudget: number,
  basePath?: string
): string {
  const parts: string[] = [];
  let remaining = tokenBudget;

  // Group by directory
  const dirs = new Map<string, OverviewEntry[]>();
  for (const entry of entries) {
    const dir = entry.file.path.split("/").slice(0, -1).join("/") || ".";
    if (!basePath || dir.startsWith(basePath)) {
      const existing = dirs.get(dir) || [];
      existing.push(entry);
      dirs.set(dir, existing);
    }
  }

  // Sort directories, most important files first within each
  const sortedDirs = [...dirs.entries()].sort((a, b) => {
    const maxA = Math.max(...a[1].map((e) => e.file.pagerank));
    const maxB = Math.max(...b[1].map((e) => e.file.pagerank));
    return maxB - maxA;
  });

  for (const [dir, dirEntries] of sortedDirs) {
    const dirLine = `${dir}/`;
    const dirCost = 5; // tokens for dir header
    if (remaining < dirCost + 20) break;

    parts.push(dirLine);
    remaining -= dirCost;

    // Sort files by PageRank within directory
    dirEntries.sort((a, b) => b.file.pagerank - a.file.pagerank);

    for (const entry of dirEntries) {
      const fileName = entry.file.path.split("/").pop() || entry.file.path;
      const symbols = entry.chunks
        .filter((c) => c.name)
        .map((c) => `${c.name}()`)
        .slice(0, 8)
        .join(", ");

      const line = `  ${fileName} [${entry.file.pagerank.toFixed(2)}] — ${symbols || "(no named exports)"}`;
      const lineCost = Math.ceil(line.length / 3.5);

      if (remaining < lineCost) break;
      parts.push(line);
      remaining -= lineCost;
    }
  }

  return parts.join("\n");
}

export function formatLookup(
  chunks: (CodeChunk & { filePath?: string; pagerank?: number })[],
  files: Map<number, FileRecord>,
  tokenBudget: number
): string {
  const parts: string[] = [];
  let remaining = tokenBudget;

  for (const chunk of chunks) {
    const file = files.get(chunk.file_id);
    const filePath = chunk.filePath || file?.path || "unknown";
    const lang = file?.language || "";

    const header = `## ${filePath}:${chunk.start_line}-${chunk.end_line} (${chunk.type}: ${chunk.name})`;
    const headerCost = Math.ceil(header.length / 3.5);
    const contentCost = chunk.token_count;
    const totalCost = headerCost + contentCost + 10;

    if (remaining < totalCost) break;

    parts.push(header);
    parts.push(`\`\`\`${lang}`);
    parts.push(chunk.content);
    parts.push("```\n");
    remaining -= totalCost;
  }

  return parts.length > 0 ? parts.join("\n") : "No results found.";
}

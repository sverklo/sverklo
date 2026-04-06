import type { Indexer } from "../../indexer/indexer.js";
import type { FileRecord } from "../../types/index.js";

export const findReferencesTool = {
  name: "sverklo_refs",
  description:
    "Find all references to a symbol across the codebase. Shows where a function, class, or type is imported, called, or used.",
  inputSchema: {
    type: "object" as const,
    properties: {
      symbol: {
        type: "string",
        description: "Symbol name to find references for",
      },
      token_budget: {
        type: "number",
        description: "Max tokens to return (default: 3000)",
      },
    },
    required: ["symbol"],
  },
};

export function handleFindReferences(
  indexer: Indexer,
  args: Record<string, unknown>
): string {
  const symbol = args.symbol as string;
  const tokenBudget = (args.token_budget as number) || 3000;

  // Use FTS to find all mentions of the symbol
  const ftsResults = indexer.chunkStore.searchFts(symbol, 50);

  const fileCache = new Map<number, FileRecord>();
  for (const f of indexer.fileStore.getAll()) {
    fileCache.set(f.id, f);
  }

  // Group by file
  const byFile = new Map<string, { line: number; context: string; type: string }[]>();

  for (const chunk of ftsResults) {
    const file = fileCache.get(chunk.file_id);
    if (!file) continue;

    // Check if this chunk actually contains the symbol name
    if (!chunk.content.includes(symbol)) continue;

    // Find specific lines with the symbol
    const lines = chunk.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(symbol)) {
        const refs = byFile.get(file.path) || [];
        refs.push({
          line: chunk.start_line + i,
          context: lines[i].trim(),
          type: chunk.type,
        });
        byFile.set(file.path, refs);
      }
    }
  }

  // Format output
  const parts: string[] = [];
  let remaining = tokenBudget;

  // Sort files by PageRank
  const sortedFiles = [...byFile.entries()].sort((a, b) => {
    const fileA = [...fileCache.values()].find((f) => f.path === a[0]);
    const fileB = [...fileCache.values()].find((f) => f.path === b[0]);
    return (fileB?.pagerank || 0) - (fileA?.pagerank || 0);
  });

  parts.push(`## References to '${symbol}' (${sortedFiles.reduce((s, [, refs]) => s + refs.length, 0)} total)\n`);

  for (const [filePath, refs] of sortedFiles) {
    const header = `### ${filePath}`;
    const headerCost = Math.ceil(header.length / 3.5);
    if (remaining < headerCost + 20) break;

    parts.push(header);
    remaining -= headerCost;

    for (const ref of refs) {
      const line = `  L${ref.line}: ${ref.context}`;
      const lineCost = Math.ceil(line.length / 3.5);
      if (remaining < lineCost) break;
      parts.push(line);
      remaining -= lineCost;
    }
    parts.push("");
  }

  return parts.length > 1 ? parts.join("\n") : `No references found for '${symbol}'.`;
}

import type { Indexer } from "../../indexer/indexer.js";

export const impactTool = {
  name: "sverklo_impact",
  description:
    "Find all code that would be impacted by changing a symbol. Returns every function/class " +
    "that references the given symbol name — critical for safe refactoring. Use BEFORE editing " +
    "a function to understand the blast radius. Much more accurate than grep because it matches " +
    "function calls and constructor invocations, not string literals or comments.",
  inputSchema: {
    type: "object" as const,
    properties: {
      symbol: {
        type: "string",
        description: "The function/class/type name to find references for",
      },
      limit: {
        type: "number",
        description: "Max references to return (default 50)",
      },
    },
    required: ["symbol"],
  },
};

export function handleImpact(indexer: Indexer, args: Record<string, unknown>): string {
  const symbol = args.symbol as string;
  const limit = (args.limit as number) || 50;

  if (!symbol) return "Error: symbol required";

  const count = indexer.symbolRefStore.getCallerCount(symbol);
  if (count === 0) {
    return `No references found for '${symbol}'. Either it's unused, the name is wrong, or it hasn't been indexed yet.`;
  }

  const results = indexer.symbolRefStore.getImpact(symbol, limit);

  const header = `## Impact analysis: '${symbol}'\n${count} reference${count === 1 ? "" : "s"} across ${new Set(results.map(r => r.file_path)).size} file${count === 1 ? "" : "s"}\n`;

  // Group by file for readability
  const byFile = new Map<string, typeof results>();
  for (const r of results) {
    const arr = byFile.get(r.file_path) || [];
    arr.push(r);
    byFile.set(r.file_path, arr);
  }

  const parts = [header];
  for (const [filePath, refs] of byFile) {
    parts.push(`\n### ${filePath}`);
    for (const ref of refs) {
      const chunkLabel = ref.chunk_name
        ? `${ref.chunk_type} ${ref.chunk_name}`
        : ref.chunk_type;
      const line = ref.ref_line ?? ref.start_line;
      parts.push(`  L${line} — ${chunkLabel}`);
    }
  }

  return parts.join("\n");
}

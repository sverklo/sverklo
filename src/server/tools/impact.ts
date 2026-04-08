import type { Indexer } from "../../indexer/indexer.js";

export const impactTool = {
  name: "sverklo_impact",
  description:
    "Refactor blast-radius: callers of a symbol with confidence scoring. Run before editing.",
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

  // Confidence scoring: how many DEFINITIONS have this name?
  // If exactly 1 definition → DIRECT (high confidence, unambiguous)
  // If multiple definitions → UNCERTAIN (name collision, multiple candidates)
  // If 0 definitions but refs exist → INFERRED (external/dynamic)
  const defCandidates = indexer.chunkStore.getByName(symbol, 20);
  const exactDefs = defCandidates.filter((c) => c.name === symbol);
  const definitionCount = exactDefs.length;

  let confidence: "DIRECT" | "UNCERTAIN" | "INFERRED";
  let confidenceNote: string;
  if (definitionCount === 1) {
    confidence = "DIRECT";
    confidenceNote = "exactly one definition found — references are unambiguous";
  } else if (definitionCount > 1) {
    confidence = "UNCERTAIN";
    confidenceNote = `${definitionCount} definitions share this name — some references may point to the wrong one`;
  } else {
    confidence = "INFERRED";
    confidenceNote = "no definition indexed — external symbol or dynamic binding";
  }

  const results = indexer.symbolRefStore.getImpact(symbol, limit);

  const confidenceIcon = confidence === "DIRECT" ? "●" : confidence === "UNCERTAIN" ? "◐" : "○";
  const header = `## Impact analysis: '${symbol}' ${confidenceIcon} ${confidence}\n${count} reference${count === 1 ? "" : "s"} across ${new Set(results.map(r => r.file_path)).size} file${count === 1 ? "" : "s"}\n_${confidenceNote}_\n`;

  // If there are multiple definitions, list them
  if (definitionCount > 1) {
    const partsWithDefs: string[] = [header, "\n### Definitions (name collision):"];
    // Load the files so we can print their paths
    const fileCache = new Map(indexer.fileStore.getAll().map((f) => [f.id, f.path]));
    for (const def of exactDefs.slice(0, 5)) {
      const filePath = fileCache.get(def.file_id) || "unknown";
      partsWithDefs.push(`  · ${def.type} ${def.name} at \`${filePath}:${def.start_line}\``);
    }
    partsWithDefs.push("");

    // Then references
    const byFile = new Map<string, typeof results>();
    for (const r of results) {
      const arr = byFile.get(r.file_path) || [];
      arr.push(r);
      byFile.set(r.file_path, arr);
    }
    partsWithDefs.push("### References:");
    for (const [filePath, refs] of byFile) {
      partsWithDefs.push(`\n#### ${filePath}`);
      for (const ref of refs) {
        const chunkLabel = ref.chunk_name
          ? `${ref.chunk_type} ${ref.chunk_name}`
          : ref.chunk_type;
        const line = ref.ref_line ?? ref.start_line;
        partsWithDefs.push(`  L${line} — ${chunkLabel}`);
      }
    }
    return partsWithDefs.join("\n");
  }

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

import type { Indexer } from "../../indexer/indexer.js";
import { findWorkspaceForProject, getWorkspaceDbPath } from "../../workspace/workspace-config.js";
import { CrossRepoDb } from "../../workspace/cross-db.js";
import type { InterfaceContract } from "../../workspace/cross-db.js";

export const impactTool = {
  name: "sverklo_impact",
  description:
    "Refactor blast-radius: callers of a symbol with confidence scoring. Run before editing. Use cross_repo:true to see impact across linked projects in a workspace.",
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
      cross_repo: {
        type: "boolean",
        description: "Include cross-repo impact from workspace projects (default false)",
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

  // Cross-repo impact (if requested and workspace exists)
  if (args.cross_repo) {
    const crossSection = getCrossRepoImpact(indexer, symbol);
    if (crossSection) {
      parts.push("\n" + crossSection);
    }
  }

  return parts.join("\n");
}

function getCrossRepoImpact(indexer: Indexer, symbol: string): string | null {
  try {
    const wsConfig = findWorkspaceForProject(indexer.rootPath);
    if (!wsConfig) {
      return "\n_No workspace found for this project. Create one with `sverklo workspace init <name> <path1> <path2>`._";
    }

    const db = new CrossRepoDb(getWorkspaceDbPath(wsConfig.workspace));

    try {
      // Find contracts matching this symbol
      const contracts = db.getContractBySymbol(symbol);
      if (contracts.length === 0) {
        // Try with Type.field pattern
        const fieldContracts = db.getContractBySymbol(`%.${symbol}`);
        if (fieldContracts.length === 0) {
          return null; // No cross-repo contracts for this symbol
        }
        return formatCrossImpact(db, fieldContracts, wsConfig.workspace);
      }
      return formatCrossImpact(db, contracts, wsConfig.workspace);
    } finally {
      db.close();
    }
  } catch {
    return null; // Silently skip cross-repo if anything fails
  }
}

function formatCrossImpact(
  db: CrossRepoDb,
  contracts: InterfaceContract[],
  workspaceName: string
): string | null {
  const parts: string[] = [`\n## Cross-repo impact (workspace: ${workspaceName})`];
  let totalEdges = 0;

  for (const contract of contracts) {
    const edges = db.getCrossEdgesForContract(contract.id!);
    if (edges.length === 0) continue;
    totalEdges += edges.length;

    parts.push(`\n### ${contract.symbolName} (${contract.interfaceType} ${contract.symbolKind})`);
    parts.push(`  defined in: \`${contract.sourceFile}:${contract.fileLine || "?"}\``);

    // Group edges by project
    const byProject = new Map<string, typeof edges>();
    for (const edge of edges) {
      const arr = byProject.get(edge.consumerProjectId) || [];
      arr.push(edge);
      byProject.set(edge.consumerProjectId, arr);
    }

    for (const [projectId, projectEdges] of byProject) {
      const project = db.getProject(projectId);
      const projectName = project?.name || projectId;
      parts.push(`\n  **${projectName}** (${projectEdges.length} reference${projectEdges.length === 1 ? "" : "s"}):`);
      for (const edge of projectEdges.slice(0, 20)) {
        const conf = edge.confidence < 1.0 ? ` (confidence: ${edge.confidence})` : "";
        parts.push(`    · \`${edge.consumerFile}:${edge.consumerLine || "?"}\` — ${edge.consumerSymbol} [${edge.edgeType}]${conf}`);
      }
      if (projectEdges.length > 20) {
        parts.push(`    _...and ${projectEdges.length - 20} more_`);
      }
    }
  }

  if (totalEdges === 0) return null;

  parts.unshift(""); // blank line before section
  return parts.join("\n");
}

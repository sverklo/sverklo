import { resolve, dirname, join } from "node:path";
import type { ImportRef } from "../types/index.js";
import type { FileStore } from "../storage/file-store.js";
import type { GraphStore } from "../storage/graph-store.js";
import { computePageRank } from "../search/pagerank.js";
import { log } from "../utils/logger.js";

// File extension resolution for relative imports
const EXTENSIONS = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
  "/index.ts",
  "/index.tsx",
  "/index.js",
  "/index.jsx",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".rb",
  ".php",
];

export function buildGraph(
  fileImports: Map<string, ImportRef[]>, // relativePath -> imports
  fileStore: FileStore,
  graphStore: GraphStore,
  rootPath: string
): void {
  const allFiles = fileStore.getAll();
  const pathToId = new Map<string, number>();
  for (const f of allFiles) {
    pathToId.set(f.path, f.id);
  }

  // Build edges
  const edges: { source: number; target: number }[] = [];

  for (const [filePath, imports] of fileImports) {
    const sourceId = pathToId.get(filePath);
    if (!sourceId) continue;

    const fileDir = dirname(filePath);

    for (const imp of imports) {
      if (!imp.isRelative) continue;

      // Try to resolve the import to a file in the index
      const resolved = resolveImport(imp.source, fileDir, pathToId);
      if (resolved !== undefined) {
        graphStore.upsert(sourceId, resolved, imp.names.length || 1);
        edges.push({ source: sourceId, target: resolved });
      }
    }
  }

  // Compute PageRank
  const fileIds = allFiles.map((f) => f.id);
  const ranks = computePageRank(fileIds, edges);

  // Write ranks back to file store
  for (const [id, rank] of ranks) {
    fileStore.updatePagerank(id, rank);
  }

  log(`Graph built: ${edges.length} edges, PageRank computed for ${fileIds.length} files`);
}

function resolveImport(
  importPath: string,
  fromDir: string,
  pathToId: Map<string, number>
): number | undefined {
  const resolved = join(fromDir, importPath);

  // Strip JS-family extensions so we can re-resolve to .ts, .tsx, etc.
  const stripped = resolved.replace(/\.(m?jsx?|cjs)$/, "");
  const bases = stripped !== resolved ? [stripped, resolved] : [resolved];

  for (const base of bases) {
    for (const ext of EXTENSIONS) {
      const candidate = base + ext;
      // Normalize path separators
      const normalized = candidate.replace(/\\/g, "/");
      const id = pathToId.get(normalized);
      if (id !== undefined) return id;
    }
  }

  return undefined;
}

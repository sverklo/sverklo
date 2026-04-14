import type { Indexer } from "../../indexer/indexer.js";
import { detectClusters, type FileCluster } from "../../search/cluster.js";

export const clustersTool = {
  name: "sverklo_clusters",
  description:
    "Detect functional clusters in the codebase — groups of tightly-connected files that form logical modules. " +
    "Useful for understanding architecture, finding module boundaries, and identifying tightly-coupled subsystems.",
  inputSchema: {
    type: "object" as const,
    properties: {
      min_size: {
        type: "number",
        description: "Minimum cluster size to show (default 3)",
      },
    },
  },
};

export function handleClusters(
  indexer: Indexer,
  args: Record<string, unknown>
): string {
  const minSize = (args.min_size as number) || 3;

  // Gather files and edges from the index
  const files = indexer.fileStore.getAll();
  if (files.length === 0) {
    return "No files indexed yet. Run sverklo_status to check indexing progress.";
  }

  const allEdges = indexer.graphStore.getAll();

  // Build file ID set for filtering edges to indexed files only
  const fileIdSet = new Set(files.map(f => f.id));

  const clusterFiles = files.map(f => ({
    id: f.id,
    path: f.path,
    pagerank: f.pagerank,
    language: f.language || "unknown",
  }));

  const clusterEdges = allEdges
    .filter(e => fileIdSet.has(e.source_file_id) && fileIdSet.has(e.target_file_id))
    .map(e => ({
      source: e.source_file_id,
      target: e.target_file_id,
      weight: e.reference_count,
    }));

  const clusters = detectClusters(clusterFiles, clusterEdges);

  // Filter by min_size
  const visible = clusters.filter(c => c.size >= minSize);

  if (visible.length === 0) {
    return `No clusters with ${minSize}+ files detected. The codebase may be too small or loosely connected.`;
  }

  // Format output
  const parts: string[] = [];
  parts.push(`## Codebase clusters (${visible.length} detected)\n`);

  for (const cluster of visible) {
    parts.push(formatCluster(cluster));
  }

  return parts.join("\n");
}

function formatCluster(cluster: FileCluster): string {
  const lines: string[] = [];

  // Header: name, size, hub
  const hubName = cluster.hubFile.split("/").pop() || cluster.hubFile;
  lines.push(`### ${cluster.id}. ${cluster.name} (${cluster.size} files, hub: ${hubName})`);

  // Show top files (up to 8) sorted by PageRank
  const shown = cluster.files.slice(0, 8);
  for (const f of shown) {
    const fileName = f.path.split("/").pop() || f.path;
    lines.push(`  · ${fileName} (PR: ${f.pagerank.toFixed(3)})`);
  }
  if (cluster.files.length > 8) {
    lines.push(`  · ... and ${cluster.files.length - 8} more`);
  }
  lines.push("");

  return lines.join("\n");
}

/**
 * Return clusters as structured data for the HTTP API / dashboard.
 */
export function getClustersJSON(indexer: Indexer): FileCluster[] {
  const files = indexer.fileStore.getAll();
  const allEdges = indexer.graphStore.getAll();
  const fileIdSet = new Set(files.map(f => f.id));

  const clusterFiles = files.map(f => ({
    id: f.id,
    path: f.path,
    pagerank: f.pagerank,
    language: f.language || "unknown",
  }));

  const clusterEdges = allEdges
    .filter(e => fileIdSet.has(e.source_file_id) && fileIdSet.has(e.target_file_id))
    .map(e => ({
      source: e.source_file_id,
      target: e.target_file_id,
      weight: e.reference_count,
    }));

  return detectClusters(clusterFiles, clusterEdges);
}

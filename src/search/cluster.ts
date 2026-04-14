// Functional cluster detection using Label Propagation Algorithm (LPA).
// Groups tightly-connected files into clusters based on import relationships.
// No external dependencies — pure TypeScript, O(E * iterations).

export interface FileCluster {
  id: number;
  name: string;           // auto-generated from common directory prefix
  files: Array<{
    path: string;
    pagerank: number;
    language: string;
  }>;
  hubFile: string;        // highest PageRank file in cluster
  size: number;           // number of files
}

interface NodeInfo {
  id: number;
  path: string;
  pagerank: number;
  language: string;
  label: number;
}

const MAX_ITERATIONS = 20;
const MIN_CLUSTER_SIZE = 3;

/**
 * Detect functional clusters in the dependency graph using Label Propagation.
 * Groups tightly-connected files into clusters based on import relationships.
 */
export function detectClusters(
  files: Array<{ id: number; path: string; pagerank: number; language: string }>,
  edges: Array<{ source: number; target: number; weight: number }>
): FileCluster[] {
  if (files.length === 0) return [];

  // Build adjacency list (undirected — imports go both ways for clustering)
  const neighbors = new Map<number, Array<{ neighbor: number; weight: number }>>();
  for (const f of files) {
    neighbors.set(f.id, []);
  }
  for (const e of edges) {
    neighbors.get(e.source)?.push({ neighbor: e.target, weight: e.weight });
    neighbors.get(e.target)?.push({ neighbor: e.source, weight: e.weight });
  }

  // Initialize: each node gets its own label
  const nodes = new Map<number, NodeInfo>();
  for (const f of files) {
    nodes.set(f.id, {
      id: f.id,
      path: f.path,
      pagerank: f.pagerank,
      language: f.language,
      label: f.id,
    });
  }

  // Iterate label propagation
  const nodeIds = files.map(f => f.id);
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let changed = false;

    // Shuffle node order each iteration to break ties fairly
    shuffleInPlace(nodeIds);

    for (const nodeId of nodeIds) {
      const node = nodes.get(nodeId)!;
      const nbrs = neighbors.get(nodeId);
      if (!nbrs || nbrs.length === 0) continue;

      // Count weighted votes for each label among neighbors
      const labelWeights = new Map<number, number>();
      for (const { neighbor, weight } of nbrs) {
        const nbrNode = nodes.get(neighbor);
        if (!nbrNode) continue;
        const label = nbrNode.label;
        labelWeights.set(label, (labelWeights.get(label) || 0) + weight);
      }

      // Pick the label with the highest total weight
      let bestLabel = node.label;
      let bestWeight = -1;
      for (const [label, w] of labelWeights) {
        if (w > bestWeight) {
          bestWeight = w;
          bestLabel = label;
        }
      }

      if (bestLabel !== node.label) {
        node.label = bestLabel;
        changed = true;
      }
    }

    if (!changed) break;
  }

  // Group nodes by label
  const labelGroups = new Map<number, NodeInfo[]>();
  for (const node of nodes.values()) {
    let group = labelGroups.get(node.label);
    if (!group) {
      group = [];
      labelGroups.set(node.label, group);
    }
    group.push(node);
  }

  // Post-process: merge tiny clusters into nearest larger neighbor
  const largeClusters = new Map<number, NodeInfo[]>();
  const tinyClusters: NodeInfo[][] = [];

  for (const [label, group] of labelGroups) {
    if (group.length >= MIN_CLUSTER_SIZE) {
      largeClusters.set(label, group);
    } else {
      tinyClusters.push(group);
    }
  }

  // For each tiny cluster, find the large cluster it's most connected to
  for (const tinyGroup of tinyClusters) {
    const connectionWeights = new Map<number, number>();

    for (const node of tinyGroup) {
      const nbrs = neighbors.get(node.id);
      if (!nbrs) continue;
      for (const { neighbor, weight } of nbrs) {
        const nbrNode = nodes.get(neighbor);
        if (!nbrNode) continue;
        // Only consider merging into large clusters
        if (largeClusters.has(nbrNode.label)) {
          connectionWeights.set(
            nbrNode.label,
            (connectionWeights.get(nbrNode.label) || 0) + weight
          );
        }
      }
    }

    // Find best large cluster to merge into
    let bestLabel = -1;
    let bestWeight = 0;
    for (const [label, w] of connectionWeights) {
      if (w > bestWeight) {
        bestWeight = w;
        bestLabel = label;
      }
    }

    if (bestLabel !== -1) {
      // Merge into the large cluster
      const target = largeClusters.get(bestLabel)!;
      for (const node of tinyGroup) {
        node.label = bestLabel;
        target.push(node);
      }
    } else {
      // No large neighbor — keep as its own cluster if it has edges,
      // otherwise discard isolated singletons
      if (tinyGroup.length > 1 || tinyGroup.some(n => (neighbors.get(n.id)?.length ?? 0) > 0)) {
        const label = tinyGroup[0].label;
        largeClusters.set(label, tinyGroup);
      }
    }
  }

  // Build final FileCluster array
  const clusters: FileCluster[] = [];
  let clusterId = 1;

  // Sort clusters by total PageRank (most important first)
  const sortedGroups = [...largeClusters.values()].sort((a, b) => {
    const sumA = a.reduce((s, n) => s + n.pagerank, 0);
    const sumB = b.reduce((s, n) => s + n.pagerank, 0);
    return sumB - sumA;
  });

  for (const group of sortedGroups) {
    // Sort files within cluster by PageRank descending
    group.sort((a, b) => b.pagerank - a.pagerank);

    const hubFile = group[0].path;
    const name = computeClusterName(group.map(n => n.path));

    clusters.push({
      id: clusterId++,
      name,
      files: group.map(n => ({
        path: n.path,
        pagerank: n.pagerank,
        language: n.language,
      })),
      hubFile,
      size: group.length,
    });
  }

  return clusters;
}

/**
 * Compute a human-readable cluster name from the common directory prefix
 * of its files. Falls back to the hub file's directory if no common prefix.
 */
function computeClusterName(paths: string[]): string {
  if (paths.length === 0) return "unknown";
  if (paths.length === 1) {
    const parts = paths[0].split("/");
    return parts.slice(0, -1).join("/") || paths[0];
  }

  // Find common directory prefix
  const segments = paths.map(p => p.split("/"));
  const minLen = Math.min(...segments.map(s => s.length));
  const common: string[] = [];

  for (let i = 0; i < minLen - 1; i++) {
    const seg = segments[0][i];
    if (segments.every(s => s[i] === seg)) {
      common.push(seg);
    } else {
      break;
    }
  }

  // If common prefix is too short (e.g., just "src"), try to find a
  // majority directory that better describes the cluster
  if (common.length <= 1 && segments[0].length > 2) {
    const dirCounts = new Map<string, number>();
    for (const seg of segments) {
      // Use the first 2-3 directory segments as the "directory identity"
      const dir = seg.slice(0, Math.min(seg.length - 1, 3)).join("/");
      dirCounts.set(dir, (dirCounts.get(dir) || 0) + 1);
    }
    let bestDir = "";
    let bestCount = 0;
    for (const [dir, count] of dirCounts) {
      if (count > bestCount) {
        bestCount = count;
        bestDir = dir;
      }
    }
    if (bestDir && bestCount > paths.length / 2) {
      return bestDir;
    }
  }

  return common.length > 0 ? common.join("/") : paths[0].split("/").slice(0, -1).join("/") || "root";
}

/** Fisher-Yates shuffle in place. */
function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

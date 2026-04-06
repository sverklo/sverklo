// PageRank implementation for file importance ranking.
// Aider's key innovation: apply PageRank to the dependency graph
// so that structurally important files (many importers) rank higher.

const DAMPING = 0.85;
const ITERATIONS = 20;
const CONVERGENCE_THRESHOLD = 0.0001;

export function computePageRank(
  fileIds: number[],
  edges: { source: number; target: number }[]
): Map<number, number> {
  const n = fileIds.length;
  if (n === 0) return new Map();

  // Build adjacency lists
  const outLinks = new Map<number, Set<number>>();
  const inLinks = new Map<number, Set<number>>();

  for (const id of fileIds) {
    outLinks.set(id, new Set());
    inLinks.set(id, new Set());
  }

  for (const { source, target } of edges) {
    outLinks.get(source)?.add(target);
    inLinks.get(target)?.add(source);
  }

  // Initialize ranks equally
  let ranks = new Map<number, number>();
  const initialRank = 1 / n;
  for (const id of fileIds) {
    ranks.set(id, initialRank);
  }

  // Iterate
  for (let iter = 0; iter < ITERATIONS; iter++) {
    const newRanks = new Map<number, number>();
    let maxDelta = 0;

    for (const id of fileIds) {
      let incomingRank = 0;
      const incomers = inLinks.get(id);
      if (incomers) {
        for (const srcId of incomers) {
          const srcOutDegree = outLinks.get(srcId)?.size || 1;
          incomingRank += (ranks.get(srcId) || 0) / srcOutDegree;
        }
      }

      const newRank = (1 - DAMPING) / n + DAMPING * incomingRank;
      newRanks.set(id, newRank);

      const delta = Math.abs(newRank - (ranks.get(id) || 0));
      if (delta > maxDelta) maxDelta = delta;
    }

    ranks = newRanks;
    if (maxDelta < CONVERGENCE_THRESHOLD) break;
  }

  // Normalize to 0-1 range
  let maxRank = 0;
  for (const r of ranks.values()) {
    if (r > maxRank) maxRank = r;
  }

  if (maxRank > 0) {
    for (const [id, r] of ranks) {
      ranks.set(id, r / maxRank);
    }
  }

  return ranks;
}

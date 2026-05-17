import type {
  ArchitecturalViolation,
  BoundarySubgraph,
  NodeLookup,
} from "./types.js";

// Detect fan-in spikes: a file's incoming-edge count crossed the
// threshold (was below, now is at or above) as a result of the diff.
// Pre-existing god modules (already at/above) don't trip.

export function detectFanInSpikes(
  pre: BoundarySubgraph,
  post: BoundarySubgraph,
  threshold: number,
  lookup: NodeLookup,
): ArchitecturalViolation[] {
  const out: ArchitecturalViolation[] = [];
  for (const n of post.nodes) {
    const preFanIn = pre.fanIn.get(n) ?? 0;
    const postFanIn = post.fanIn.get(n) ?? 0;
    if (postFanIn < threshold) continue;
    const newInThisDiff = preFanIn < threshold;
    out.push({
      kind: "fan_in_spike",
      file: lookup.idToPath.get(n) ?? `#${n}`,
      preFanIn,
      postFanIn,
      threshold,
      newInThisDiff,
    });
  }
  return out;
}

// Parse a non-negative integer threshold from CLI arg. Returns null on
// invalid input — callers should treat that as a configuration error.
export function parseThreshold(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = parseInt(raw, 10);
  if (n < 1) return null;
  return n;
}

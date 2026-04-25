// Partition plans (v0.14, P1-11). When a tool returns more results than
// an agent can reasonably consume in one pass (e.g. sverklo_impact on a
// core type with 400 callers), we return a *plan* — a partitioning of
// the result set into sub-questions the host agent can fan out over —
// rather than a 400-row dump.
//
// Strategy, in order of preference:
//   1. Cluster axis  — group by Louvain/LPA clusters (from src/search/cluster.ts).
//                       Works when a single repo has distinct subsystems.
//   2. Directory axis — group by path prefix (2 levels deep).
//                       Fallback when no cluster dominates.
//   3. Pass-through  — return the raw list if already below the threshold.

export const DEFAULT_PARTITION_THRESHOLD = 80;
const MIN_BUCKET_SIZE = 3;

export type PartitionAxis = "cluster" | "directory" | "symbol_neighborhood";

export interface PartitionBucket {
  label: string;                // human-readable bucket name
  filter: Record<string, string>; // arg suggestion for re-querying, e.g. {scope: "src/auth/"}
  est_count: number;            // how many items landed in this bucket
  sample: string[];             // up to 3 representative paths/names
}

export interface PartitionPlan {
  axis: PartitionAxis;
  total: number;
  buckets: PartitionBucket[];
  note: string;                 // explanatory line for the agent
}

export interface PartitionInput {
  path: string;                 // repo-relative file path
  clusterId?: number | null;    // optional Louvain/LPA cluster id
  clusterName?: string | null;
}

export interface PartitionClusterInfo {
  id: number;
  name: string;
}

/**
 * Decide how to partition a large result list. `threshold` is the point
 * above which we fall back from raw dump to a plan.
 */
export function partitionPlan(
  items: PartitionInput[],
  opts: {
    threshold?: number;
    clusters?: PartitionClusterInfo[];
    axisPreference?: PartitionAxis;
  } = {}
): PartitionPlan | null {
  const threshold = opts.threshold ?? DEFAULT_PARTITION_THRESHOLD;
  if (items.length <= threshold) return null;

  // 1. Try cluster axis.
  if (opts.axisPreference !== "directory" && opts.clusters && opts.clusters.length > 0) {
    const byCluster = groupBy(items, (x) =>
      x.clusterId != null ? String(x.clusterId) : "_unclustered"
    );
    const dominant = biggestBucket(byCluster);
    // Require the top cluster to cover <= 50% of items — if one cluster
    // swallows everything, the axis isn't useful and we fall through.
    if (dominant.count <= Math.ceil(items.length * 0.6) && byCluster.size >= 2) {
      const clusterNameById = new Map(opts.clusters.map((c) => [String(c.id), c.name]));
      const buckets: PartitionBucket[] = [];
      for (const [key, rows] of byCluster) {
        if (rows.length < MIN_BUCKET_SIZE && key === "_unclustered") {
          // skip tiny unclustered tail — agent can query without filter
          continue;
        }
        const name =
          key === "_unclustered"
            ? "(no cluster)"
            : clusterNameById.get(key) ?? rows[0].clusterName ?? `cluster_${key}`;
        buckets.push({
          label: name,
          filter: { cluster: name },
          est_count: rows.length,
          sample: rows.slice(0, 3).map((r) => r.path),
        });
      }
      buckets.sort((a, b) => b.est_count - a.est_count);
      return {
        axis: "cluster",
        total: items.length,
        buckets,
        note:
          `${items.length} results exceeds ${threshold} — partitioned into ${buckets.length} clusters. ` +
          `Re-run the same tool with {scope:"<dir>"} or sub-query by cluster label.`,
      };
    }
  }

  // 2. Directory axis.
  const byDir = groupBy(items, (x) => dirPrefix(x.path));
  const buckets: PartitionBucket[] = [];
  for (const [dir, rows] of byDir) {
    if (rows.length < MIN_BUCKET_SIZE) continue;
    buckets.push({
      label: `${dir}/`,
      filter: { scope: `${dir}/` },
      est_count: rows.length,
      sample: rows.slice(0, 3).map((r) => r.path),
    });
  }
  buckets.sort((a, b) => b.est_count - a.est_count);

  // If directory split also failed to shrink anything, return null (caller
  // should fall back to truncated raw output).
  if (buckets.length === 0) return null;

  return {
    axis: "directory",
    total: items.length,
    buckets,
    note:
      `${items.length} results exceeds ${threshold} — partitioned into ${buckets.length} ` +
      `directories. Re-run with {scope:"<prefix>"} to drill in.`,
  };
}

export function formatPlan(plan: PartitionPlan): string {
  const parts: string[] = [];
  parts.push(
    `## Partition plan (${plan.axis}, ${plan.buckets.length} buckets over ${plan.total} results)`
  );
  parts.push("");
  for (const b of plan.buckets) {
    const filterStr = Object.entries(b.filter)
      .map(([k, v]) => `${k}:"${v}"`)
      .join(" ");
    parts.push(`### ${b.label} — ${b.est_count} result(s)`);
    parts.push(`  drill in: \`${filterStr}\``);
    if (b.sample.length > 0) {
      for (const s of b.sample) parts.push(`  - ${s}`);
      if (b.est_count > b.sample.length) {
        parts.push(`  - …${b.est_count - b.sample.length} more`);
      }
    }
    parts.push("");
  }
  parts.push(`_${plan.note}_`);
  return parts.join("\n");
}

// ── helpers ─────────────────────────────────────────────────────────

function groupBy<T>(items: T[], keyOf: (x: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const x of items) {
    const k = keyOf(x);
    const bucket = out.get(k);
    if (bucket) bucket.push(x);
    else out.set(k, [x]);
  }
  return out;
}

function biggestBucket(m: Map<string, unknown[]>): { key: string; count: number } {
  let best = { key: "", count: 0 };
  for (const [k, v] of m) {
    if (v.length > best.count) best = { key: k, count: v.length };
  }
  return best;
}

function dirPrefix(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 2) return parts.slice(0, -1).join("/") || ".";
  // Two levels — "src/auth/middleware.ts" → "src/auth".
  return parts.slice(0, 2).join("/");
}

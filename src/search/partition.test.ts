import { describe, it, expect } from "vitest";
import { partitionPlan, formatPlan, DEFAULT_PARTITION_THRESHOLD } from "./partition.js";

function mkItems(n: number, pathGen: (i: number) => string, clusterOf?: (i: number) => number | null) {
  return Array.from({ length: n }, (_, i) => ({
    path: pathGen(i),
    clusterId: clusterOf?.(i) ?? null,
    clusterName: clusterOf && clusterOf(i) != null ? `c_${clusterOf(i)}` : null,
  }));
}

describe("partitionPlan", () => {
  it("returns null when under the threshold", () => {
    const items = mkItems(10, (i) => `src/a/${i}.ts`);
    expect(partitionPlan(items)).toBeNull();
  });

  it("falls back to directory axis when no clusters provided", () => {
    const items = [
      ...mkItems(30, (i) => `src/auth/file${i}.ts`),
      ...mkItems(30, (i) => `src/api/file${i}.ts`),
      ...mkItems(30, (i) => `src/db/file${i}.ts`),
    ];
    const plan = partitionPlan(items, { threshold: 20 });
    expect(plan).toBeTruthy();
    expect(plan!.axis).toBe("directory");
    expect(plan!.buckets).toHaveLength(3);
    expect(plan!.buckets.map((b) => b.label).sort()).toEqual([
      "src/api/",
      "src/auth/",
      "src/db/",
    ]);
    // Samples are truncated to 3
    for (const b of plan!.buckets) {
      expect(b.sample.length).toBeLessThanOrEqual(3);
    }
  });

  it("uses cluster axis when clusters are available and distribute results", () => {
    const items = [
      ...mkItems(30, (i) => `src/foo/f${i}.ts`, () => 1),
      ...mkItems(30, (i) => `src/bar/b${i}.ts`, () => 2),
      ...mkItems(30, (i) => `src/baz/z${i}.ts`, () => 3),
    ];
    const plan = partitionPlan(items, {
      threshold: 20,
      clusters: [
        { id: 1, name: "cluster_A" },
        { id: 2, name: "cluster_B" },
        { id: 3, name: "cluster_C" },
      ],
    });
    expect(plan).toBeTruthy();
    expect(plan!.axis).toBe("cluster");
    expect(plan!.buckets).toHaveLength(3);
    expect(plan!.buckets.map((b) => b.label).sort()).toEqual([
      "cluster_A",
      "cluster_B",
      "cluster_C",
    ]);
  });

  it("falls back from cluster to directory when a single cluster dominates", () => {
    const items = [
      ...mkItems(100, (i) => `src/main/m${i}.ts`, () => 1),
      ...mkItems(10, (i) => `src/other/o${i}.ts`, () => 2),
    ];
    const plan = partitionPlan(items, {
      threshold: 50,
      clusters: [
        { id: 1, name: "dominant" },
        { id: 2, name: "tiny" },
      ],
    });
    expect(plan).toBeTruthy();
    // Cluster 1 has 100/110 = 91% > 60% cutoff → falls through to directory.
    expect(plan!.axis).toBe("directory");
  });

  it("formats a plan with drill-in hints", () => {
    const items = [
      ...mkItems(30, (i) => `src/auth/f${i}.ts`),
      ...mkItems(30, (i) => `src/api/f${i}.ts`),
      ...mkItems(30, (i) => `src/db/f${i}.ts`),
    ];
    const plan = partitionPlan(items, { threshold: 20 })!;
    const out = formatPlan(plan);
    expect(out).toContain("Partition plan");
    expect(out).toContain("drill in:");
    expect(out).toContain('scope:"src/auth/"');
  });

  it("uses the documented default threshold when none provided", () => {
    const items = mkItems(DEFAULT_PARTITION_THRESHOLD, (i) => `src/a/f${i}.ts`);
    // Exactly at threshold → still null (strict >)
    expect(partitionPlan(items)).toBeNull();
  });
});

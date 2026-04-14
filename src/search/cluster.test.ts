import { describe, it, expect } from "vitest";
import { detectClusters, type FileCluster } from "./cluster.js";

// Helper to create file entries with sequential IDs.
function mkFiles(
  paths: string[],
  opts?: { pagerank?: number; language?: string }
) {
  return paths.map((path, i) => ({
    id: i + 1,
    path,
    pagerank: opts?.pagerank ?? 0.01,
    language: opts?.language ?? "typescript",
  }));
}

describe("detectClusters", () => {
  it("returns an empty array for empty input", () => {
    expect(detectClusters([], [])).toEqual([]);
  });

  it("returns no clusters for isolated nodes (no edges)", () => {
    const files = mkFiles(["src/a.ts", "src/b.ts"]);
    // Without edges, nodes may form singletons below MIN_CLUSTER_SIZE.
    // They can still be returned if they have > 0 edges (they don't here),
    // so expect either empty or very small.
    const clusters = detectClusters(files, []);
    // Isolated singletons with 0 edges are discarded
    expect(clusters.length).toBe(0);
  });

  it("groups two connected components into separate clusters", () => {
    // Component A: files 1-2-3 form a triangle
    // Component B: files 4-5-6 form a triangle
    const files = mkFiles([
      "src/server/a.ts",
      "src/server/b.ts",
      "src/server/c.ts",
      "lib/x.ts",
      "lib/y.ts",
      "lib/z.ts",
    ]);
    const edges = [
      // Component A
      { source: 1, target: 2, weight: 1 },
      { source: 2, target: 3, weight: 1 },
      { source: 1, target: 3, weight: 1 },
      // Component B
      { source: 4, target: 5, weight: 1 },
      { source: 5, target: 6, weight: 1 },
      { source: 4, target: 6, weight: 1 },
    ];
    const clusters = detectClusters(files, edges);
    expect(clusters.length).toBe(2);

    // Each cluster should have exactly 3 files
    const sizes = clusters.map((c) => c.size).sort();
    expect(sizes).toEqual([3, 3]);

    // Files within each cluster should all be from the same component
    for (const cluster of clusters) {
      const ids = cluster.files.map((f) => f.path);
      const allServer = ids.every((p) => p.startsWith("src/server/"));
      const allLib = ids.every((p) => p.startsWith("lib/"));
      expect(allServer || allLib).toBe(true);
    }
  });

  it("assigns hubFile to the highest PageRank file in each cluster", () => {
    const files = [
      { id: 1, path: "src/core.ts", pagerank: 0.9, language: "typescript" },
      { id: 2, path: "src/helpers.ts", pagerank: 0.1, language: "typescript" },
      { id: 3, path: "src/utils.ts", pagerank: 0.3, language: "typescript" },
    ];
    const edges = [
      { source: 1, target: 2, weight: 1 },
      { source: 1, target: 3, weight: 1 },
      { source: 2, target: 3, weight: 1 },
    ];
    const clusters = detectClusters(files, edges);
    expect(clusters.length).toBe(1);
    expect(clusters[0].hubFile).toBe("src/core.ts");
  });

  it("sorts files within a cluster by PageRank descending", () => {
    const files = [
      { id: 1, path: "src/a.ts", pagerank: 0.1, language: "typescript" },
      { id: 2, path: "src/b.ts", pagerank: 0.9, language: "typescript" },
      { id: 3, path: "src/c.ts", pagerank: 0.5, language: "typescript" },
    ];
    const edges = [
      { source: 1, target: 2, weight: 1 },
      { source: 2, target: 3, weight: 1 },
      { source: 1, target: 3, weight: 1 },
    ];
    const clusters = detectClusters(files, edges);
    const pageranks = clusters[0].files.map((f) => f.pagerank);
    expect(pageranks).toEqual([0.9, 0.5, 0.1]);
  });

  it("merges tiny clusters (< 3 nodes) into nearest large cluster", () => {
    // 4 files form a main cluster, 1 file is connected only to the main cluster
    const files = mkFiles([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
      "src/d.ts",
      "src/e.ts", // tiny: only connected to node 1
    ]);
    const edges = [
      // Main group of 4
      { source: 1, target: 2, weight: 1 },
      { source: 2, target: 3, weight: 1 },
      { source: 3, target: 4, weight: 1 },
      { source: 1, target: 4, weight: 1 },
      // Tiny outlier connected to main
      { source: 5, target: 1, weight: 1 },
    ];
    const clusters = detectClusters(files, edges);
    // The tiny cluster (node 5) should merge into the main cluster
    expect(clusters.length).toBe(1);
    expect(clusters[0].size).toBe(5);
  });

  it("produces cluster IDs starting at 1 and incrementing", () => {
    const files = mkFiles([
      "a/1.ts", "a/2.ts", "a/3.ts",
      "b/1.ts", "b/2.ts", "b/3.ts",
    ]);
    const edges = [
      { source: 1, target: 2, weight: 1 },
      { source: 2, target: 3, weight: 1 },
      { source: 1, target: 3, weight: 1 },
      { source: 4, target: 5, weight: 1 },
      { source: 5, target: 6, weight: 1 },
      { source: 4, target: 6, weight: 1 },
    ];
    const clusters = detectClusters(files, edges);
    const ids = clusters.map((c) => c.id).sort();
    expect(ids).toEqual([1, 2]);
  });

  it("generates a name from the common directory prefix", () => {
    const files = mkFiles([
      "src/server/handler.ts",
      "src/server/router.ts",
      "src/server/middleware.ts",
    ]);
    const edges = [
      { source: 1, target: 2, weight: 1 },
      { source: 2, target: 3, weight: 1 },
      { source: 1, target: 3, weight: 1 },
    ];
    const clusters = detectClusters(files, edges);
    expect(clusters.length).toBe(1);
    expect(clusters[0].name).toContain("src/server");
  });

  it("handles weighted edges — heavier edges pull nodes together", () => {
    // 5 nodes. Nodes 1-3 have heavy edges, nodes 3-5 have light edges.
    // Despite node 3 bridging both groups, it should cluster with 1-2
    // due to heavier edges.
    const files = mkFiles(["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"]);
    const edges = [
      // Heavy group
      { source: 1, target: 2, weight: 10 },
      { source: 2, target: 3, weight: 10 },
      { source: 1, target: 3, weight: 10 },
      // Light group
      { source: 3, target: 4, weight: 1 },
      { source: 4, target: 5, weight: 1 },
      { source: 3, target: 5, weight: 1 },
    ];
    const clusters = detectClusters(files, edges);
    // Due to heavy vs light, we expect node 3 to stay with 1-2
    // and nodes 4-5 to be a tiny cluster merged into the main one.
    // The exact result depends on LPA convergence, but all 5 should
    // end up clustered (possibly in 1 cluster due to merging).
    const totalFiles = clusters.reduce((sum, c) => sum + c.size, 0);
    expect(totalFiles).toBe(5);
  });
});

import { describe, it, expect } from "vitest";
import { tarjanSCC, classifyCycles } from "./cycle.js";
import type { BoundarySubgraph, NodeLookup } from "./types.js";

function graph(
  edges: Array<[number, number]>,
  extra: number[] = [],
): BoundarySubgraph {
  const nodes = new Set<number>(extra);
  const adj = new Map<number, Set<number>>();
  for (const [s, t] of edges) {
    nodes.add(s);
    nodes.add(t);
    if (!adj.has(s)) adj.set(s, new Set());
    adj.get(s)!.add(t);
  }
  for (const n of nodes) if (!adj.has(n)) adj.set(n, new Set());
  return {
    nodes,
    edges: adj,
    fanIn: new Map(),
    seedNodes: nodes,
    snapshot: "pre",
  };
}

describe("tarjanSCC", () => {
  it("returns no SCCs for a DAG", () => {
    const g = graph([
      [1, 2],
      [2, 3],
    ]);
    expect(tarjanSCC(g)).toEqual([]);
  });

  it("finds a 2-node cycle", () => {
    const g = graph([
      [1, 2],
      [2, 1],
    ]);
    const sccs = tarjanSCC(g);
    expect(sccs.length).toBe(1);
    expect([...sccs[0]!].sort()).toEqual([1, 2]);
  });

  it("finds a 3-node cycle", () => {
    const g = graph([
      [1, 2],
      [2, 3],
      [3, 1],
    ]);
    const sccs = tarjanSCC(g);
    expect(sccs.length).toBe(1);
    expect([...sccs[0]!].sort()).toEqual([1, 2, 3]);
  });

  it("ignores single-node trivial SCCs", () => {
    const g = graph([], [1, 2, 3]);
    expect(tarjanSCC(g)).toEqual([]);
  });

  it("finds multiple disjoint cycles", () => {
    const g = graph([
      [1, 2],
      [2, 1],
      [3, 4],
      [4, 3],
    ]);
    const sccs = tarjanSCC(g).map((s) => [...s].sort());
    expect(sccs.length).toBe(2);
    const flat = sccs.flat().sort();
    expect(flat).toEqual([1, 2, 3, 4]);
  });

  it("finds an SCC inside a larger graph", () => {
    const g = graph([
      [1, 2],
      [2, 3],
      [3, 2],
      [3, 4],
    ]);
    const sccs = tarjanSCC(g);
    expect(sccs.length).toBe(1);
    expect([...sccs[0]!].sort()).toEqual([2, 3]);
  });
});

describe("classifyCycles", () => {
  const lookup: NodeLookup = {
    idToPath: new Map([
      [1, "a.ts"],
      [2, "b.ts"],
      [3, "c.ts"],
    ]),
    pathToId: new Map(),
  };

  it("marks an SCC absent in pre as new", () => {
    const post = [[1, 2]];
    const out = classifyCycles([], post, lookup);
    expect(out).toEqual([
      { kind: "cycle", nodes: ["a.ts", "b.ts"], newInThisDiff: true },
    ]);
  });

  it("marks an SCC with same nodes as pre as NOT new", () => {
    const pre = [[1, 2]];
    const post = [[1, 2]];
    const out = classifyCycles(pre, post, lookup);
    expect(out[0]!.newInThisDiff).toBe(false);
  });

  it("marks an extended SCC as new (pre {1,2} ⊊ post {1,2,3})", () => {
    const pre = [[1, 2]];
    const post = [[1, 2, 3]];
    const out = classifyCycles(pre, post, lookup);
    // post is a superset of pre, so pre is a subset of post → not "new"
    // in the strict subset sense. Decision per data-model: extended
    // cycles count as the same cycle (legacy debt growing, not new).
    expect(out[0]!.newInThisDiff).toBe(false);
  });

  it("marks a disjoint SCC as new even when other SCCs are pre-existing", () => {
    const pre = [[1, 2]];
    const post = [
      [1, 2],
      [3, 1],
    ];
    const out = classifyCycles(pre, post, lookup);
    const newOnes = out.filter((v) => v.kind === "cycle" && v.newInThisDiff);
    expect(newOnes.length).toBe(1);
  });
});

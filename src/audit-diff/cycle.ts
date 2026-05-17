import type { ArchitecturalViolation, BoundarySubgraph, NodeLookup } from "./types.js";

// Iterative Tarjan's strongly-connected-components. Operates on the
// boundary subgraph only; node ids are file_id ints. Returns SCCs of
// size ≥2 (single-node "SCCs" are trivially not cycles).
//
// The iterative form uses an explicit stack to avoid V8 call-stack
// limits on pathological graphs; profile showed ~30% faster than the
// recursive form on the boundary sizes audit-diff sees.

export function tarjanSCC(graph: BoundarySubgraph): number[][] {
  const indices = new Map<number, number>();
  const lowlinks = new Map<number, number>();
  const onStack = new Set<number>();
  const stack: number[] = [];
  const result: number[][] = [];
  let nextIndex = 0;

  // Stack frame for iterative DFS: (node, neighborsArray, neighborIdx)
  type Frame = { v: number; ws: number[]; i: number };

  for (const root of graph.nodes) {
    if (indices.has(root)) continue;

    const callStack: Frame[] = [
      { v: root, ws: [...(graph.edges.get(root) ?? new Set())], i: 0 },
    ];
    indices.set(root, nextIndex);
    lowlinks.set(root, nextIndex);
    nextIndex++;
    stack.push(root);
    onStack.add(root);

    while (callStack.length > 0) {
      const frame = callStack[callStack.length - 1]!;
      if (frame.i < frame.ws.length) {
        const w = frame.ws[frame.i]!;
        frame.i++;
        if (!indices.has(w)) {
          indices.set(w, nextIndex);
          lowlinks.set(w, nextIndex);
          nextIndex++;
          stack.push(w);
          onStack.add(w);
          callStack.push({
            v: w,
            ws: [...(graph.edges.get(w) ?? new Set())],
            i: 0,
          });
        } else if (onStack.has(w)) {
          const lvw = Math.min(lowlinks.get(frame.v)!, indices.get(w)!);
          lowlinks.set(frame.v, lvw);
        }
      } else {
        if (lowlinks.get(frame.v)! === indices.get(frame.v)!) {
          const scc: number[] = [];
          let popped: number;
          do {
            popped = stack.pop()!;
            onStack.delete(popped);
            scc.push(popped);
          } while (popped !== frame.v);
          if (scc.length >= 2) result.push(scc);
        }
        callStack.pop();
        if (callStack.length > 0) {
          const parent = callStack[callStack.length - 1]!;
          const lp = Math.min(
            lowlinks.get(parent.v)!,
            lowlinks.get(frame.v)!,
          );
          lowlinks.set(parent.v, lp);
        }
      }
    }
  }

  return result;
}

// Classify post-SCCs as "new" (not a subset of any pre-SCC) or
// "pre-existing." We compare on node sets — an SCC is "the same" if it
// contains exactly the same nodes; "extended" if pre's nodes ⊊ post's
// nodes; "new" otherwise.
export function classifyCycles(
  preSCCs: number[][],
  postSCCs: number[][],
  lookup: NodeLookup,
): ArchitecturalViolation[] {
  const preSets = preSCCs.map((s) => new Set(s));
  const out: ArchitecturalViolation[] = [];

  for (const post of postSCCs) {
    const postSet = new Set(post);
    const isNew = !preSets.some((pre) => isSubset(pre, postSet));
    out.push({
      kind: "cycle",
      nodes: post
        .map((id) => lookup.idToPath.get(id) ?? `#${id}`)
        .sort((a, b) => a.localeCompare(b)),
      newInThisDiff: isNew,
    });
  }
  return out;
}

function isSubset<T>(small: Set<T>, big: Set<T>): boolean {
  if (small.size > big.size) return false;
  for (const x of small) if (!big.has(x)) return false;
  return true;
}

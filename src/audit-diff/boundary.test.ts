import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildPreBoundary,
  computeFanIn,
  extractImportPaths,
  resolveImportToFileId,
  applyDiffEdits,
} from "./boundary.js";
import type { GraphReader, FilePathResolver } from "./boundary.js";

// Build a fake graph + path resolver from a node-edge specification.
function fixture(
  edges: Array<[number, number]>,
  paths: Record<number, string>,
): { graph: GraphReader; resolver: FilePathResolver } {
  const out = new Map<number, Array<{ source_file_id: number; target_file_id: number; reference_count: number }>>();
  const in_ = new Map<number, Array<{ source_file_id: number; target_file_id: number; reference_count: number }>>();
  for (const [s, t] of edges) {
    const entry = { source_file_id: s, target_file_id: t, reference_count: 1 };
    (out.get(s) ?? out.set(s, []).get(s)!).push(entry);
    (in_.get(t) ?? in_.set(t, []).get(t)!).push(entry);
  }
  return {
    graph: {
      getImports: (id) => out.get(id) ?? [],
      getImporters: (id) => in_.get(id) ?? [],
    },
    resolver: {
      pathToId: (p) => {
        for (const [id, path] of Object.entries(paths)) {
          if (path === p) return Number(id);
        }
        return null;
      },
      idToPath: (id) => paths[id] ?? null,
    },
  };
}

describe("buildPreBoundary", () => {
  it("includes seed nodes and their 1-hop neighbors", () => {
    const { graph, resolver } = fixture(
      [
        [1, 2], // 1 imports 2
        [3, 1], // 3 imports 1 (importer of 1)
        [4, 5], // unrelated
      ],
      { 1: "a.ts", 2: "b.ts", 3: "c.ts", 4: "d.ts", 5: "e.ts" },
    );
    const { graph: pre } = buildPreBoundary({ graph, resolver, seeds: [1] });
    expect([...pre.nodes].sort()).toEqual([1, 2, 3]); // 1, plus its 1-hop
    expect(pre.snapshot).toBe("pre");
  });

  it("excludes 2-hop nodes", () => {
    const { graph, resolver } = fixture(
      [
        [1, 2],
        [2, 3], // 3 is 2-hop from 1
      ],
      { 1: "a.ts", 2: "b.ts", 3: "c.ts" },
    );
    const { graph: pre } = buildPreBoundary({ graph, resolver, seeds: [1] });
    expect(pre.nodes.has(3)).toBe(false);
  });

  it("computes fan-in for boundary nodes", () => {
    const { graph, resolver } = fixture(
      [
        [1, 4],
        [2, 4],
        [3, 4], // 4 has fan-in 3 inside boundary
      ],
      { 1: "a.ts", 2: "b.ts", 3: "c.ts", 4: "d.ts" },
    );
    const { graph: pre } = buildPreBoundary({
      graph,
      resolver,
      seeds: [1, 2, 3],
    });
    expect(pre.fanIn.get(4)).toBe(3);
  });
});

describe("computeFanIn", () => {
  it("counts incoming edges per node", () => {
    const nodes = new Set([1, 2, 3]);
    const edges = new Map([
      [1, new Set([2, 3])],
      [2, new Set([3])],
    ]);
    const fanIn = computeFanIn(nodes, edges);
    expect(fanIn.get(1)).toBe(0);
    expect(fanIn.get(2)).toBe(1);
    expect(fanIn.get(3)).toBe(2);
  });

  it("ignores edges pointing outside the node set", () => {
    const nodes = new Set([1, 2]);
    const edges = new Map([[1, new Set([2, 99])]]);
    const fanIn = computeFanIn(nodes, edges);
    expect(fanIn.get(2)).toBe(1);
    expect(fanIn.has(99)).toBe(false);
  });
});

describe("extractImportPaths", () => {
  it("extracts ES module static imports", () => {
    expect(extractImportPaths(`import x from "./a.js";`)).toEqual(["./a.js"]);
    expect(extractImportPaths(`import {b} from "./b";`)).toEqual(["./b"]);
  });

  it("extracts dynamic imports", () => {
    expect(extractImportPaths(`const m = await import("./c");`)).toEqual(["./c"]);
  });

  it("extracts CommonJS requires", () => {
    expect(extractImportPaths(`const x = require("./d")`)).toEqual(["./d"]);
  });

  it("deduplicates repeats", () => {
    expect(
      extractImportPaths(`import a from "./x"; import b from "./x";`),
    ).toEqual(["./x"]);
  });

  it("returns empty for source with no imports", () => {
    expect(extractImportPaths(`const x = 1;`)).toEqual([]);
  });
});

describe("resolveImportToFileId", () => {
  const resolver: FilePathResolver = {
    pathToId: (p) => {
      const map: Record<string, number> = {
        "src/b.ts": 2,
        "src/c/index.ts": 3,
      };
      return map[p] ?? null;
    },
    idToPath: () => null,
  };

  it("resolves relative .ts with explicit extension", () => {
    expect(resolveImportToFileId("src/a.ts", "./b.ts", resolver)).toBe(2);
  });

  it("resolves relative extensionless to .ts", () => {
    expect(resolveImportToFileId("src/a.ts", "./b", resolver)).toBe(2);
  });

  it("resolves directory to /index.ts", () => {
    expect(resolveImportToFileId("src/a.ts", "./c", resolver)).toBe(3);
  });

  it("returns null for bare specifiers (node modules)", () => {
    expect(resolveImportToFileId("src/a.ts", "react", resolver)).toBeNull();
  });

  it("returns null for unresolvable relative paths", () => {
    expect(resolveImportToFileId("src/a.ts", "./missing", resolver)).toBeNull();
  });
});

describe("applyDiffEdits", () => {
  it("replaces the modified file's outgoing edges with parsed imports", () => {
    const tmp = mkdtempSync(join(tmpdir(), "audit-diff-boundary-"));
    try {
      mkdirSync(join(tmp, "src"), { recursive: true });
      writeFileSync(
        join(tmp, "src/a.ts"),
        `import x from "./b.ts";\nimport y from "./c.ts";\n`,
      );
      writeFileSync(join(tmp, "src/b.ts"), "");
      writeFileSync(join(tmp, "src/c.ts"), "");

      const { graph, resolver } = fixture(
        [[1, 2]], // pre: a → b
        { 1: "src/a.ts", 2: "src/b.ts", 3: "src/c.ts" },
      );
      const pre = buildPreBoundary({ graph, resolver, seeds: [1, 2, 3] });
      const post = applyDiffEdits({
        pre: pre.graph,
        lookup: pre.lookup,
        resolver,
        diffEntries: [{ path: "src/a.ts", status: "modified" }],
        projectRoot: tmp,
        baseRef: "HEAD",
      });
      // a → {b, c} now (added c)
      expect([...(post.edges.get(1) ?? new Set())].sort()).toEqual([2, 3]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

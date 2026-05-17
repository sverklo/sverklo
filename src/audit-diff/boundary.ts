import { readFileSync, existsSync } from "node:fs";
import { join, posix } from "node:path";
import type {
  BoundarySubgraph,
  DiffEntry,
  DiffSet,
  NodeLookup,
} from "./types.js";
import { getFileAtRef } from "./diff-parser.js";

// Lightweight backbone for the audit-diff feature: build the pre/post
// boundary subgraph from sverklo's existing GraphStore + a re-parse of
// the changed files' imports. The full tree-sitter parser is too slow
// for the <200ms pre-commit budget, so we use a regex-based import
// extractor that handles the common ES-module + CommonJS patterns.

export interface GraphReader {
  getImports: (fileId: number) => Array<{ source_file_id: number; target_file_id: number; reference_count: number }>;
  getImporters: (fileId: number) => Array<{ source_file_id: number; target_file_id: number; reference_count: number }>;
}

export interface FilePathResolver {
  pathToId: (path: string) => number | null;
  idToPath: (id: number) => string | null;
}

export interface BuildBoundaryOptions {
  graph: GraphReader;
  resolver: FilePathResolver;
  seeds: number[]; // file_ids in the diff
}

// Build the "pre" boundary subgraph from the existing index.
export function buildPreBoundary(
  opts: BuildBoundaryOptions,
): { graph: BoundarySubgraph; lookup: NodeLookup } {
  const nodes = new Set<number>(opts.seeds);
  const edges = new Map<number, Set<number>>();
  const idToPath = new Map<number, string>();
  const pathToId = new Map<string, number>();

  const ensureLookup = (id: number) => {
    if (idToPath.has(id)) return;
    const p = opts.resolver.idToPath(id);
    if (p) {
      idToPath.set(id, p);
      pathToId.set(p, id);
    }
  };

  // 1-hop expansion: collect neighbors of every seed.
  for (const seed of opts.seeds) {
    ensureLookup(seed);
    for (const e of opts.graph.getImports(seed)) {
      nodes.add(e.target_file_id);
      ensureLookup(e.target_file_id);
    }
    for (const e of opts.graph.getImporters(seed)) {
      nodes.add(e.source_file_id);
      ensureLookup(e.source_file_id);
    }
  }

  // Build adjacency for all boundary nodes (full edge set among nodes).
  for (const n of nodes) {
    const targets = new Set<number>();
    for (const e of opts.graph.getImports(n)) {
      if (nodes.has(e.target_file_id)) targets.add(e.target_file_id);
    }
    edges.set(n, targets);
  }

  const fanIn = computeFanIn(nodes, edges);

  return {
    graph: {
      nodes,
      edges,
      fanIn,
      seedNodes: new Set(opts.seeds),
      snapshot: "pre",
    },
    lookup: { idToPath, pathToId },
  };
}

export function computeFanIn(
  nodes: Set<number>,
  edges: Map<number, Set<number>>,
): Map<number, number> {
  const fanIn = new Map<number, number>();
  for (const n of nodes) fanIn.set(n, 0);
  for (const [, targets] of edges) {
    for (const t of targets) {
      if (fanIn.has(t)) fanIn.set(t, (fanIn.get(t) ?? 0) + 1);
    }
  }
  return fanIn;
}

// Regex-based import extractor. Covers ES module static imports,
// dynamic imports, and CommonJS require. False negatives (e.g. computed
// string concatenation) are tolerated — the downstream cycle/fan-in
// checks only need the static dependency edges that the existing index
// already understands.
const STATIC_IMPORT_RE =
  /(?:^|[^\w])import\s+(?:[^"'`]*?\s+from\s+)?["'`]([^"'`]+)["'`]/g;
const DYNAMIC_IMPORT_RE = /(?:^|[^\w])import\s*\(\s*["'`]([^"'`]+)["'`]/g;
const REQUIRE_RE = /(?:^|[^\w])require\s*\(\s*["'`]([^"'`]+)["'`]/g;

export function extractImportPaths(source: string): string[] {
  const out = new Set<string>();
  for (const re of [STATIC_IMPORT_RE, DYNAMIC_IMPORT_RE, REQUIRE_RE]) {
    for (const m of source.matchAll(re)) {
      if (m[1]) out.add(m[1]);
    }
  }
  return [...out];
}

// Resolve a relative-or-bare import specifier to a repo-relative path
// + file_id, if we can. Returns null for bare specifiers (node modules,
// type-only packages, etc.) — those don't enter the boundary subgraph.
export function resolveImportToFileId(
  fromFile: string,
  importPath: string,
  resolver: FilePathResolver,
): number | null {
  if (!importPath.startsWith(".")) return null;
  const fromDir = posix.dirname(fromFile);
  const resolved = posix.normalize(posix.join(fromDir, importPath));
  // TypeScript NodeNext / esnext convention writes the import target with
  // a `.js` extension that resolves to the corresponding `.ts` on disk.
  // Strip + re-add a candidate set so we cover both the literal path and
  // the TS-resolved variant. The index is authoritative.
  const stripped = resolved.replace(/\.(jsx?|mjs|cjs)$/, "");
  const bases = stripped === resolved ? [resolved] : [resolved, stripped];
  const candidates = new Set<string>();
  for (const base of bases) {
    candidates.add(base);
    candidates.add(`${base}.ts`);
    candidates.add(`${base}.tsx`);
    candidates.add(`${base}.js`);
    candidates.add(`${base}.jsx`);
    candidates.add(`${base}/index.ts`);
    candidates.add(`${base}/index.js`);
  }
  for (const c of candidates) {
    const id = resolver.pathToId(c);
    if (id !== null) return id;
  }
  return null;
}

export interface ApplyDiffEditsOptions {
  pre: BoundarySubgraph;
  lookup: NodeLookup;
  resolver: FilePathResolver;
  diffEntries: DiffEntry[];
  projectRoot: string;
  baseRef: string;
}

// Clone the pre-subgraph and apply the modifications from the working
// tree. For each changed file, replace its outgoing edge set with what
// the current file content imports (resolved against the existing index).
export function applyDiffEdits(opts: ApplyDiffEditsOptions): BoundarySubgraph {
  const post: BoundarySubgraph = {
    nodes: new Set(opts.pre.nodes),
    edges: new Map<number, Set<number>>(),
    fanIn: new Map<number, number>(),
    seedNodes: new Set(opts.pre.seedNodes),
    snapshot: "post",
  };
  for (const [k, v] of opts.pre.edges) {
    post.edges.set(k, new Set(v));
  }

  for (const entry of opts.diffEntries) {
    const fileId = opts.lookup.pathToId.get(entry.path);
    if (fileId === undefined) continue;

    const fullPath = join(opts.projectRoot, entry.path);
    if (!existsSync(fullPath)) continue;

    const source = readFileSync(fullPath, "utf8");
    const importPaths = extractImportPaths(source);
    const newTargets = new Set<number>();
    for (const ip of importPaths) {
      const tid = resolveImportToFileId(entry.path, ip, opts.resolver);
      if (tid !== null && post.nodes.has(tid)) newTargets.add(tid);
    }
    post.edges.set(fileId, newTargets);
  }

  post.fanIn = computeFanIn(post.nodes, post.edges);
  return post;
}

// Build a snapshot of what the file IMPORTED at HEAD — used when we
// need a precise pre-graph that doesn't already exist in the index
// (rare, but supported for --against arbitrary-ref).
export function buildPreImportsFromRef(
  cwd: string,
  ref: string,
  entries: DiffEntry[],
  resolver: FilePathResolver,
): Map<number, Set<number>> {
  const map = new Map<number, Set<number>>();
  for (const entry of entries) {
    const fileId = resolver.pathToId(entry.path);
    if (fileId === null) continue;
    const src = getFileAtRef(cwd, ref, entry.path);
    if (src === null) continue;
    const targets = new Set<number>();
    for (const ip of extractImportPaths(src)) {
      const tid = resolveImportToFileId(entry.path, ip, resolver);
      if (tid !== null) targets.add(tid);
    }
    map.set(fileId, targets);
  }
  return map;
}

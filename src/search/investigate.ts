import type { Indexer } from "../indexer/indexer.js";
import { cosineSimilarity } from "../indexer/embedder.js";
import type { SearchResult, CodeChunk, FileRecord } from "../types/index.js";
import { expandTokens, expandFtsQuery } from "./synonyms.js";

const RRF_K = 60;

// "graph-expand" expands top hits one hop along typed edges with per-type
// weights (calls > documents > extends > imports). The expansion runs
// AFTER the first three retrievers so it sees the same candidate base.
// "module" is a dedicated channel for file-header / module-level chunks
// so they don't compete on equal RRF terms with function bodies (shorter
// chunks are naturally lower-cosine but semantically richer per token).
// "path" runs the path-token defs in their own RRF channel so a single
// matched file's later defs (e.g. groupByDirectory in compact.ts) get
// independent rank-share rather than competing with hits from every
// other matched file.
// "upstream" follows imports backward from the top base hits to surface
// heavily-imported "god-files" — central modules (routers, DI injectors,
// runtime engines) that every feature file depends on but no individual
// query lexically matches. bench:swe v0.17 surfaced this as the dominant
// failure mode across Express/NestJS/Prisma; v0.18 ships the channel
// behind expandUpstream and the eval harness measures whether it's a
// strict improvement before the default flips.
export type RetrievalMethod = "fts" | "vector" | "symbol" | "refs" | "graph-expand" | "module" | "path" | "upstream";

export const EDGE_WEIGHTS: Record<string, number> = {
  calls: 1.0,
  documents: 0.8,
  extends: 0.7,
  imports: 0.6,
};

export interface InvestigateHit {
  chunk: CodeChunk;
  file: FileRecord;
  score: number;
  found_by: RetrievalMethod[];
}

export interface InvestigateResult {
  query: string;
  hits: InvestigateHit[];
  budget_used: Record<RetrievalMethod, number>;
}

export interface InvestigateOptions {
  query: string;
  scope?: string;
  budget?: number; // cap on each sub-retriever's candidate count
  /**
   * When true, after the four base retrievers run, expand top-20 hits
   * one hop along typed edges (calls / documents / imports / extends)
   * and fuse the expansion as a 5th ranker. Bumps recall on multi-hop
   * questions ("everywhere auth state mutates") at small latency cost.
   * Default: false (P1-9 ships the capability, callers opt in until the
   * eval harness shows it's a strict improvement).
   */
  expandGraph?: boolean;
  /**
   * When true, walk the file-import graph BACKWARD from the top base
   * hits up to depth 2 and add chunks from the heavily-imported parent
   * files (top-decile PageRank) to the candidate pool. Closes the
   * "god-file" recall failure that bench:swe v0.17 surfaced across
   * Express/NestJS/Prisma — central files (lib/router/index.js,
   * packages/core/injector/injector.ts, LibraryEngine.ts) that every
   * feature file imports but no individual query lexically matches.
   * Default: false (v0.18 ships behind the flag, eval harness measures
   * whether it's a strict improvement before the default flips).
   */
  expandUpstream?: boolean;
}

/**
 * Multi-signal investigation: runs BM25, vector, symbol lookup, and reference
 * expansion in parallel then RRF-fuses them. Returns hits tagged with which
 * retriever(s) surfaced them, so the agent can see whether a result is
 * semantically + structurally agreed-upon or a single-signal outlier.
 */
export async function runInvestigate(
  indexer: Indexer,
  opts: InvestigateOptions
): Promise<InvestigateResult> {
  const budget = opts.budget ?? 50;

  const fileCache = buildFileCache(indexer);

  // Synonym-expanded FTS query: "check" → "check OR verify OR validate OR audit"
  // so questions phrased in natural language reach files named after their
  // verbs (verify.ts, validate.ts, etc.). Vector channel doesn't need this
  // — the embedder handles its own semantic relations.
  const ftsQuery = expandFtsQuery(opts.query);
  const fts = runFts(indexer, ftsQuery, budget, opts.scope, fileCache);
  // Q1: split vector retrieval so doc chunks (long markdown sections) can't
  // drown out focused function bodies. Each channel ranks independently in
  // RRF; code is the primary signal, docs add a complementary surface.
  const { code: vec, doc: docVec } = await runVectorSplit(indexer, opts.query, budget, opts.scope);
  // Symbol/refs channels expand tokens so "check" hits chunks named
  // verifyEvidence, validateInput, etc.
  const symTokens = expandTokens(extractSymbolTokens(opts.query));
  const sym = runSymbols(indexer, symTokens, Math.min(budget, 12));
  const refs = runRefs(indexer, symTokens, Math.min(budget, 12));
  // Q1: pull all defining chunks from the top FTS-result files. Catches
  // private helpers (rankCandidates inside hybrid-search.ts, etc.) that
  // FTS itself ranks below the file's hero chunk because the helper's
  // body matches a smaller fraction of the query. Includes file-header
  // module chunks interleaved at their line position — empirically the
  // interleaving outranks splitting them into a dedicated channel.
  const defs = runDefinitionsInFtsFiles(indexer, fts.slice(0, 20), fileCache);
  // Q1b: also pull defs from files whose PATH matches a query token even
  // if the file body didn't FTS-match. Catches "How does sverklo verify…"
  // → src/server/tools/verify.ts which contains the verb only via the
  // filename, not the prose body.
  const pathDefs = runDefinitionsByPathTokens(indexer, opts.query, fileCache, opts.scope);

  const scores = new Map<number, { total: number; methods: Set<RetrievalMethod> }>();

  accumulate(scores, fts, "fts");
  accumulate(scores, vec, "vector");
  accumulate(scores, docVec, "vector"); // share the channel; rank order keeps docs second-fiddle
  accumulate(scores, sym, "symbol");
  accumulate(scores, refs, "refs");
  // defs already includes module-type chunks interleaved at start_line.
  accumulate(scores, defs, "symbol");
  // pathDefs in their own channel so later defs in a path-matched file
  // get independent RRF treatment instead of being washed by the rest.
  accumulate(scores, pathDefs, "path");

  // 5th ranker: typed-edge expansion of the top hits so far.
  let expandedIds: number[] = [];
  if (opts.expandGraph) {
    const seedIds = topNFromScores(scores, 20);
    expandedIds = expandViaTypedEdges(indexer, seedIds);
    accumulate(scores, expandedIds, "graph-expand");
  }

  // 6th ranker: upstream traversal — walk imports backward from the top
  // base hits and surface heavily-imported parent files (god-files).
  let upstreamIds: number[] = [];
  if (opts.expandUpstream) {
    const seedIds = topNFromScores(scores, 20);
    upstreamIds = expandViaUpstreamImports(indexer, seedIds, fileCache);
    accumulate(scores, upstreamIds, "upstream");
  }

  const hits: InvestigateHit[] = [];
  for (const [chunkId, s] of scores) {
    const chunk = indexer.chunkStore.getById(chunkId);
    if (!chunk) continue;
    const file = fileCache.get(chunk.file_id);
    if (!file) continue;
    if (opts.scope && !file.path.startsWith(opts.scope)) continue;

    hits.push({
      chunk,
      file,
      score: s.total,
      found_by: Array.from(s.methods).sort(),
    });
  }

  hits.sort((a, b) => b.score - a.score);

  return {
    query: opts.query,
    hits,
    budget_used: {
      fts: fts.length,
      vector: vec.length,
      symbol: sym.length,
      refs: refs.length,
      "graph-expand": expandedIds.length,
      module: 0,
      path: pathDefs.length,
      upstream: upstreamIds.length,
    },
  };
}

/**
 * Pull the top-N chunk ids out of the cumulative score map.
 */
function topNFromScores(
  scores: Map<number, { total: number; methods: Set<RetrievalMethod> }>,
  n: number
): number[] {
  return Array.from(scores.entries())
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, n)
    .map(([id]) => id);
}

/**
 * Walk the symbol-ref graph one hop from each seed chunk. Edge type is
 * derived from the chunk relationship: a referencing chunk → its target
 * is a "calls" edge; same-file siblings are "imports"; doc_section/doc_code
 * neighbors are "documents". RRF treats all of these as a single ranker
 * (graph-expand), but candidates are weighted by edge type before fusion.
 */
function expandViaTypedEdges(indexer: Indexer, seedIds: number[]): number[] {
  const out: Array<{ id: number; weight: number }> = [];
  const seen = new Set<number>(seedIds);

  for (const seedId of seedIds) {
    const seed = indexer.chunkStore.getById(seedId);
    if (!seed) continue;

    // calls: chunks that reference symbols defined in seed
    if (seed.name) {
      const callers = indexer.symbolRefStore.getImpact(seed.name, 5);
      for (const r of callers) {
        if (seen.has(r.chunk_id)) continue;
        seen.add(r.chunk_id);
        out.push({ id: r.chunk_id, weight: EDGE_WEIGHTS.calls });
      }
    }

    // documents: doc chunks that mention the seed's symbol name
    if (seed.name) {
      try {
        const mentions = indexer.docEdgeStore.getBySymbol(seed.name, 5);
        for (const m of mentions) {
          if (seen.has(m.doc_chunk_id)) continue;
          seen.add(m.doc_chunk_id);
          out.push({ id: m.doc_chunk_id, weight: EDGE_WEIGHTS.documents });
        }
      } catch { /* pre-v3 schema */ }
    }

    // Note (Q3 v0.15-rc): we deliberately do NOT expand to same-file
    // siblings here. The base candidate set already includes all chunks
    // from every FTS file (see runVector's candidateChunkIds expansion),
    // so adding siblings as a 5th-ranker signal just adds noise without
    // recall. We keep cross-file edges only — calls + documents.
  }

  // Stable rank by weight DESC. Equal-weight ties keep insertion order.
  out.sort((a, b) => b.weight - a.weight);
  return out.map((x) => x.id);
}

/**
 * Top-decile PageRank threshold for the indexed file set. Cached per call;
 * the caller passes the file cache built once at the top of runInvestigate.
 *
 * Files with `pagerank === 0` are excluded from the percentile computation
 * (they're either un-imported orphans or pre-PageRank-pass entries) so the
 * threshold reflects the actual structural importance distribution rather
 * than being dragged toward zero by the long tail.
 */
function topDecileThreshold(fileCache: Map<number, FileRecord>): number {
  const ranks: number[] = [];
  for (const f of fileCache.values()) {
    if (f.pagerank > 0) ranks.push(f.pagerank);
  }
  if (ranks.length === 0) return 0;
  ranks.sort((a, b) => b - a);
  const idx = Math.max(0, Math.floor(ranks.length * 0.1) - 1);
  return ranks[idx] ?? 0;
}

/**
 * Walk the file-import graph BACKWARD from each seed chunk's file up to
 * MAX_DEPTH hops, surfacing parent files whose PageRank is in the top
 * decile. For each qualifying parent, emit its module-level chunk first
 * (file-intent prose) followed by up to 3 named definitions ordered by
 * line position. This is the inverse of the existing
 * `runDefinitionsInFtsFiles` pattern: that one walks from chunk → file →
 * defs in the SAME file; this one walks from chunk → file → upstream
 * importers → their defs.
 *
 * The motivation lives in bench:swe v0.17: questions like "how does
 * Express dispatch a request to the right route handler" surface
 * `lib/router/route.js` (a feature file with a clear name) but miss
 * `lib/router/index.js` (the central dispatch file that imports
 * `route.js` and binds it to the application). The central file has
 * top-decile PageRank because nearly every other file in the repository
 * imports it, but no individual feature query lexically matches it.
 *
 * Two parameters are conservative on purpose. Depth 2 catches grandparent
 * routers without runaway BFS on dense monorepos. The top-3 chunks-per-
 * parent cap prevents a single high-PageRank god-file from saturating the
 * candidate pool — RRF can still upweight it, but it doesn't crowd out
 * the more specific feature hits that surfaced it.
 */
function expandViaUpstreamImports(
  indexer: Indexer,
  seedIds: number[],
  fileCache: Map<number, FileRecord>
): number[] {
  const MAX_DEPTH = 2;
  const MAX_PARENTS = 10;
  const CHUNKS_PER_PARENT = 3;

  const threshold = topDecileThreshold(fileCache);
  if (threshold <= 0) return [];

  // Collect unique seed file IDs from the seed chunks.
  const seedFileIds = new Set<number>();
  for (const id of seedIds) {
    const chunk = indexer.chunkStore.getById(id);
    if (chunk) seedFileIds.add(chunk.file_id);
  }

  // BFS upward through importers, depth-bounded. A file is "visited" once
  // we've seen it at any depth — closer hops win on rank ties via insertion
  // order, which lines up with how an engineer would investigate.
  const visited = new Set<number>(seedFileIds);
  const qualified: Array<{ fileId: number; depth: number; pagerank: number }> = [];
  let frontier = Array.from(seedFileIds);
  for (let depth = 1; depth <= MAX_DEPTH && frontier.length > 0; depth++) {
    const next: number[] = [];
    for (const fileId of frontier) {
      const importers = indexer.graphStore.getImporters(fileId);
      for (const dep of importers) {
        const importerId = dep.source_file_id;
        if (visited.has(importerId)) continue;
        visited.add(importerId);
        const file = fileCache.get(importerId);
        if (!file) continue;
        if (file.pagerank >= threshold) {
          qualified.push({ fileId: importerId, depth, pagerank: file.pagerank });
        }
        next.push(importerId);
      }
    }
    frontier = next;
  }

  // Rank parents by PageRank DESC (higher PageRank = more central), then
  // by depth ASC (closer hops first as a tiebreaker). Cap at MAX_PARENTS.
  qualified.sort((a, b) => {
    if (b.pagerank !== a.pagerank) return b.pagerank - a.pagerank;
    return a.depth - b.depth;
  });
  const parents = qualified.slice(0, MAX_PARENTS);

  // For each qualifying parent, emit module-level chunk(s) first, then
  // up to CHUNKS_PER_PARENT named definitions in line order.
  const out: number[] = [];
  const emitted = new Set<number>(seedIds);
  for (const { fileId } of parents) {
    const fileChunks = indexer.chunkStore
      .getByFile(fileId)
      .filter((c) =>
        c.name &&
        (c.type === "module" ||
          c.type === "function" ||
          c.type === "class" ||
          c.type === "method" ||
          c.type === "type" ||
          c.type === "interface")
      );
    const moduleChunks = fileChunks.filter((c) => c.type === "module");
    const defChunks = fileChunks
      .filter((c) => c.type !== "module")
      .sort((a, b) => a.start_line - b.start_line)
      .slice(0, CHUNKS_PER_PARENT);
    for (const c of moduleChunks) {
      if (emitted.has(c.id)) continue;
      emitted.add(c.id);
      out.push(c.id);
    }
    for (const c of defChunks) {
      if (emitted.has(c.id)) continue;
      emitted.add(c.id);
      out.push(c.id);
    }
  }
  return out;
}

function runFts(
  indexer: Indexer,
  query: string,
  budget: number,
  scope: string | undefined,
  fileCache: Map<number, FileRecord>
): number[] {
  const results = indexer.chunkStore.searchFts(query, budget);
  if (!scope) return results.map((r) => r.id);
  return results
    .filter((r) => {
      const file = fileCache.get(r.file_id);
      return file ? file.path.startsWith(scope) : false;
    })
    .map((r) => r.id);
}

async function runVectorSplit(
  indexer: Indexer,
  query: string,
  budget: number,
  scope?: string
): Promise<{ code: number[]; doc: number[] }> {
  const [queryVector] = await indexer.embed([query]);
  if (!queryVector) return { code: [], doc: [] };

  // Broadcast: every embedding gets cosine'd. To stop long doc chunks
  // from drowning code retrieval, we score chunks separately by category:
  // code chunks (function/class/type/etc) and doc chunks (doc_section /
  // doc_code). Each list contributes its own ordered ranks to RRF.
  const allEmbeddings = indexer.embeddingStore.getAll();
  const fileCache = new Map<number, FileRecord>();
  for (const f of indexer.fileStore.getAll()) fileCache.set(f.id, f);

  const codeScored: { id: number; score: number }[] = [];
  const docScored: { id: number; score: number }[] = [];

  for (const [chunkId, vec] of allEmbeddings) {
    const chunk = indexer.chunkStore.getById(chunkId);
    if (!chunk) continue;
    if (scope) {
      const file = fileCache.get(chunk.file_id);
      if (!file || !file.path.startsWith(scope)) continue;
    }
    const score = cosineSimilarity(queryVector, vec);
    if (chunk.type === "doc_section" || chunk.type === "doc_code") {
      docScored.push({ id: chunkId, score });
    } else {
      codeScored.push({ id: chunkId, score });
    }
  }
  codeScored.sort((a, b) => b.score - a.score);
  docScored.sort((a, b) => b.score - a.score);
  return {
    code: codeScored.slice(0, budget).map((x) => x.id),
    doc: docScored.slice(0, Math.ceil(budget / 2)).map((x) => x.id),
  };
}

function runSymbols(indexer: Indexer, tokens: string[], perToken: number): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const t of tokens) {
    const chunks = indexer.chunkStore.getByName(t, perToken);
    for (const c of chunks) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      ids.push(c.id);
    }
  }
  return ids;
}

/**
 * Walk the top-N FTS-hit chunks back to their files, then pull *every*
 * definition-typed chunk from those files. The premise: when FTS surfaces
 * a file at all, every defined symbol in that file is a plausible answer
 * to the question — even ones whose body doesn't match the query directly.
 * This is the move that closes the "private-helper" gap revealed by the
 * research eval (rankCandidates, runInvestigate, verifyEvidence,
 * partitionPlan, etc).
 */
function runDefinitionsInFtsFiles(
  indexer: Indexer,
  ftsHitIds: number[],
  fileCache: Map<number, FileRecord>
): number[] {
  // Group hit chunks by file, preserving FTS order so the first FTS hit's
  // file ranks first (and its defs land near the top).
  const fileOrder: number[] = [];
  const seenFile = new Set<number>();
  for (const id of ftsHitIds) {
    const chunk = indexer.chunkStore.getById(id);
    if (!chunk) continue;
    if (seenFile.has(chunk.file_id)) continue;
    seenFile.add(chunk.file_id);
    fileOrder.push(chunk.file_id);
  }

  // Within each file, emit chunks in start_line order — function bodies
  // and module headers interleave at their natural file position. The
  // interleaving puts file-level docstrings (typically near the top) at
  // a low RRF rank, where they outscore later in-body function chunks.
  const out: number[] = [];
  const seen = new Set<number>(ftsHitIds);
  for (const fileId of fileOrder) {
    const file = fileCache.get(fileId);
    void file;
    const chunks = indexer.chunkStore
      .getByFile(fileId)
      .filter((c) =>
        c.name &&
        (c.type === "function" ||
          c.type === "class" ||
          c.type === "method" ||
          c.type === "type" ||
          c.type === "interface" ||
          c.type === "module")
      )
      .sort((a, b) => a.start_line - b.start_line);
    for (const c of chunks) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c.id);
    }
  }
  return out;
}

/**
 * Files whose path contains a token from the query — even when the body
 * of those files doesn't FTS-match. Catches the case where verbs in the
 * question are reflected in directory / file names ("verify" → tools/verify.ts).
 * Defs from these files enter the candidate pool with the same RRF treatment
 * as `runDefinitionsInFtsFiles`.
 */
function runDefinitionsByPathTokens(
  indexer: Indexer,
  query: string,
  fileCache: Map<number, FileRecord>,
  scope?: string
): number[] {
  const repoName = guessRepoName(fileCache);
  const originalsRaw = extractSymbolTokens(query)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length >= 4)
    .filter((t) => t !== repoName);
  // Drop trivial inflections so "tests" → "test", "validates" → "validate".
  // Conservative: only -s and -es endings; doesn't try to handle irregulars.
  const singularize = (t: string): string =>
    t.endsWith("ies") && t.length > 4 ? t.slice(0, -3) + "y"
    : t.endsWith("s") && !t.endsWith("ss") && t.length > 4 ? t.slice(0, -1)
    : t;
  const originals = Array.from(new Set([...originalsRaw, ...originalsRaw.map(singularize)]));
  const synSet = new Set(
    expandTokens(originals)
      .map((t) => t.toLowerCase())
      .filter((t) => t.length >= 4)
      .filter((t) => t !== repoName)
  );
  if (synSet.size === 0) return [];

  // Two passes: (1) files whose basename matches an ORIGINAL query token,
  // (2) files matching a synonym-only expansion. Within each pass, sort
  // by match specificity so the most-direct lexical match wins one of
  // the limited slots: exact-stem (audit.ts vs token "audit") beats
  // contains (audit-html.ts vs token "audit") beats synonym match.
  type Candidate = { file: FileRecord; specificity: number };
  const allCandidates: Candidate[] = [];
  const originalsSet = new Set(originals);
  for (const f of fileCache.values()) {
    if (scope && !f.path.startsWith(scope)) continue;
    const baseLower = basename(f.path).toLowerCase();
    const stem = baseLower.replace(/\.[^.]+$/, ""); // strip extension(s)
    // Compound bonus: every hyphen-separated piece of the stem matches an
    // original token → treat as stem-equal-equivalent. token-budget.ts vs
    // a query mentioning both "token" AND "budget" beats budget.ts.
    const stemParts = stem.split("-").filter((p) => p.length > 0);
    const allPartsMatch = stemParts.length >= 2 && stemParts.every((p) => originalsSet.has(p));
    let best = -1;
    // Compound match (every hyphen part matches an original) gets the
    // strongest specificity — it indicates the file is named for the
    // exact conjunction of concepts the question asks about.
    if (allPartsMatch) best = 110;
    for (const t of originals) {
      if (stem === t) { best = Math.max(best, 100); continue; }
      if (stem.startsWith(t + "-") || stem.endsWith("-" + t)) { best = Math.max(best, 50); continue; }
      if (baseLower.includes(t)) { best = Math.max(best, 25); continue; }
    }
    if (best < 0) {
      for (const t of synSet) {
        if (originals.includes(t)) continue;
        // Synonym scores stay strictly below original-token scores so an
        // original "audit" never gets displaced by a synonym match.
        // Tiers: stem-exact 40 < original-prefix 50; stem-prefix 20;
        // contains 5.
        if (stem === t) { best = Math.max(best, 40); continue; }
        if (stem.startsWith(t + "-") || stem.endsWith("-" + t)) { best = Math.max(best, 20); continue; }
        if (baseLower.includes(t)) { best = Math.max(best, 5); }
      }
    }
    if (best > 0) allCandidates.push({ file: f, specificity: best });
  }
  allCandidates.sort((a, b) => b.specificity - a.specificity);
  const matched: FileRecord[] = allCandidates.slice(0, 12).map((c) => c.file);
  const seenFiles = new Set<number>(matched.map((f) => f.id));

  // Emit defs file-by-file in matched order (specificity-sorted), with a
  // per-file cap so a single noisy file with many helpers can't push a
  // later file's defs past the eval cutoff. Cap chosen to keep a 7-symbol
  // file like compact.ts contributing every public def, while limiting a
  // 30-symbol mega-file to its top fraction.
  const PER_FILE_CAP = 8;
  const out: number[] = [];
  const seen = new Set<number>();
  for (const f of matched) {
    const defs = indexer.chunkStore
      .getByFile(f.id)
      .filter((c) =>
        c.name &&
        (c.type === "function" ||
          c.type === "class" ||
          c.type === "method" ||
          c.type === "type" ||
          c.type === "interface" ||
          c.type === "module")
      )
      .sort((a, b) => a.start_line - b.start_line)
      .slice(0, PER_FILE_CAP);
    for (const c of defs) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c.id);
    }
  }
  return out;
}

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

function guessRepoName(fileCache: Map<number, FileRecord>): string {
  // First path segment of the most-common prefix is a good-enough heuristic.
  const first = fileCache.values().next().value;
  if (!first) return "";
  const parts = first.path.split("/").filter(Boolean);
  return (parts[0] ?? "").toLowerCase();
}

function runRefs(indexer: Indexer, tokens: string[], perToken: number): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const t of tokens) {
    const impacts = indexer.symbolRefStore.getImpact(t, perToken);
    for (const r of impacts) {
      if (seen.has(r.chunk_id)) continue;
      seen.add(r.chunk_id);
      ids.push(r.chunk_id);
    }
  }
  return ids;
}

// Per-channel weight applied on top of the standard 1/(K+rank+1) RRF score.
// Path is 1.5× because path-token matches are deliberately precision-skewed
// (they only fire when the question's vocabulary aligns with file naming),
// so a hit there is a strong signal that vector/FTS may have missed.
const CHANNEL_WEIGHTS: Partial<Record<RetrievalMethod, number>> = {
  path: 1.5,
};

function accumulate(
  out: Map<number, { total: number; methods: Set<RetrievalMethod> }>,
  ids: number[],
  method: RetrievalMethod
): void {
  const w = CHANNEL_WEIGHTS[method] ?? 1;
  for (let rank = 0; rank < ids.length; rank++) {
    const id = ids[rank];
    const score = w * (1 / (RRF_K + rank + 1));
    const prior = out.get(id);
    if (prior) {
      prior.total += score;
      prior.methods.add(method);
    } else {
      out.set(id, { total: score, methods: new Set([method]) });
    }
  }
}

function buildFileCache(indexer: Indexer): Map<number, FileRecord> {
  const cache = new Map<number, FileRecord>();
  for (const f of indexer.fileStore.getAll()) cache.set(f.id, f);
  return cache;
}

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "does", "do", "did",
  "how", "what", "where", "when", "why", "who", "which",
  "it", "its", "this", "that", "these", "those",
  "to", "of", "in", "on", "for", "with", "by", "from", "at",
  "and", "or", "but", "so",
  "i", "you", "we", "they", "he", "she",
  "can", "should", "would", "could", "may",
  "not", "no",
  "code", "function", "class", "module", "file",
]);

/**
 * Pull likely symbol candidates out of a natural-language query. Splits
 * camelCase / snake_case, drops stopwords and very short tokens. Returns
 * at most 6 to keep investigate bounded.
 */
export function extractSymbolTokens(query: string): string[] {
  // Keep full identifiers (incl. snake_case + camelCase) AND expand them so the
  // symbol-lookup retriever gets multiple candidate names.
  const raw = query
    .split(/[^A-Za-z0-9_]+/)
    .filter((t) => t.length >= 3);

  const expanded = new Set<string>();
  for (const tok of raw) {
    const lower = tok.toLowerCase();
    if (STOPWORDS.has(lower)) continue;
    expanded.add(tok);

    // snake_case split
    if (tok.includes("_")) {
      for (const part of tok.split("_")) {
        if (part.length >= 3 && !STOPWORDS.has(part.toLowerCase())) expanded.add(part);
      }
    }

    // camelCase split: getUserById → get, User, ById
    if (/[a-z][A-Z]/.test(tok)) {
      const camelParts = tok.replace(/([a-z])([A-Z])/g, "$1 $2").split(/\s+/);
      for (const part of camelParts) {
        if (part.length >= 2 && !STOPWORDS.has(part.toLowerCase())) expanded.add(part);
      }
    }
  }

  // Cap kept generous (was 6, now 10) so domain tokens that happen to
  // appear late in a question — "exceeds the token budget" — don't get
  // dropped before they reach the path retriever.
  return Array.from(expanded).slice(0, 10);
}

/**
 * Format investigate results as a single text block. Mirrors the
 * formatResults shape from hybrid-search so agents get a consistent view.
 */
export function formatInvestigate(result: InvestigateResult, maxHits: number = 10): string {
  const parts: string[] = [];
  parts.push(`## Investigation: "${result.query}"`);
  const b = result.budget_used;
  parts.push(
    `● ${result.hits.length} results fused from: fts(${b.fts}), vector(${b.vector}), symbol(${b.symbol}), refs(${b.refs})` +
      (b["graph-expand"] > 0 ? `, graph-expand(${b["graph-expand"]})` : "")
  );
  parts.push("");

  const shown = result.hits.slice(0, maxHits);
  for (let i = 0; i < shown.length; i++) {
    const h = shown[i];
    const name = h.chunk.name ? `: ${h.chunk.name}` : "";
    const foundBy = h.found_by.join(", ");
    parts.push(
      `${i + 1}. ${h.file.path}:${h.chunk.start_line}-${h.chunk.end_line} [${h.chunk.type}${name}] — found by: ${foundBy}`
    );
  }

  if (result.hits.length > maxHits) {
    parts.push("");
    parts.push(`_+${result.hits.length - maxHits} more — pass max_hits:${result.hits.length} to see all._`);
  }

  if (result.hits.length === 0) {
    parts.push(
      "No candidates surfaced across any signal. Try a broader query or a specific symbol name."
    );
  }

  return parts.join("\n");
}

// SearchResult type reused from hybrid-search for consumers that want it.
export type { SearchResult };

import type { Indexer } from "../indexer/indexer.js";
import { cosineSimilarity } from "../indexer/embedder.js";
import type { SearchResult, CodeChunk, FileRecord, ChunkType } from "../types/index.js";
import { log } from "../utils/logger.js";
import {
  entryPointBonus,
  pathSuffixAlignmentBonus,
  currentFileDistancePenalty,
} from "./boost.js";

interface SearchOptions {
  query: string;
  tokenBudget: number;
  scope?: string;
  language?: string;
  type?: ChunkType | "any";
  /**
   * Repo-relative path of the file the user is currently editing. When
   * provided, candidates are gently penalized by directory distance so
   * results closer to the active file rank higher in tie-breaks. Pass
   * undefined to disable. See ./boost.ts.
   */
  currentFile?: string;
}

// Reciprocal Rank Fusion constant
const RRF_K = 60;

// Issue #4: query-shape classification. Research showed semantic search
// consistently underperforms on framework-wiring questions where the
// answer lives in an annotation, config file, or build-time-generated
// class rather than in code that names the concept being searched for.
// When we detect one of these shapes, we lower confidence and surface a
// suggestion to fall back to Grep for the specific annotation pattern.
const FRAMEWORK_WIRING_TOKENS = [
  "registered",
  "registration",
  "autowired",
  "auto-wired",
  "auto-discovered",
  "bean",
  "beans",
  "annotation",
  "annotated",
  "interceptor",
  "decorator",
  "middleware setup",
  "wired",
  "wiring",
  "injected",
  "injection",
  "provider",
  "providers",
  "binding",
  "bound to",
  "@component",
  "@configuration",
  "@service",
  "@repository",
  "@inject",
  "@module",
];

function classifyQueryShape(query: string): {
  shape: "general" | "framework_wiring";
  reason?: string;
} {
  const lower = query.toLowerCase();
  const hit = FRAMEWORK_WIRING_TOKENS.find((t) => lower.includes(t));
  if (hit) {
    return {
      shape: "framework_wiring",
      reason: `query mentions "${hit}" — framework registration/wiring questions are often better answered by grep for the specific annotation`,
    };
  }
  return { shape: "general" };
}

/**
 * Build a confidence signal from the ranked candidates. Low confidence
 * means either (a) no strong top result, or (b) the top and second-best
 * results are too close to distinguish, or (c) the query shape is one
 * we know semantic search struggles with.
 *
 * This is advisory — the results still come back, but the agent sees a
 * hint at the bottom suggesting grep as a fallback. Issue #4.
 */
function computeConfidence(
  ranked: SearchResult[],
  queryShape: ReturnType<typeof classifyQueryShape>
): {
  level: "high" | "medium" | "low";
  reason: string | null;
} {
  if (ranked.length === 0) {
    return { level: "low", reason: "no results matched" };
  }

  const top = ranked[0].score;
  const second = ranked[1]?.score ?? 0;

  // The RRF scores are small (~0.03 at rank 0 for k=60). A "strong"
  // top-of-rank hit lands around ~0.03+. Below ~0.005 the query is
  // either matching weakly or is out-of-distribution. These thresholds
  // were calibrated against the profiler results in issue #6.
  const WEAK_TOP_THRESHOLD = 0.005;

  if (top < WEAK_TOP_THRESHOLD) {
    return {
      level: "low",
      reason: "top result has a weak relevance score; the query may be out of distribution",
    };
  }

  // Gap ratio: if the second result is >= 80% of the top result, the
  // ranking has no clear winner and an agent copying the first result
  // is taking a coin flip.
  if (second > 0 && second / top > 0.8) {
    if (queryShape.shape === "framework_wiring") {
      return {
        level: "low",
        reason: queryShape.reason!,
      };
    }
    return {
      level: "medium",
      reason: "top two results are close — consider reading both or refining the query",
    };
  }

  if (queryShape.shape === "framework_wiring") {
    return {
      level: "medium",
      reason: queryShape.reason!,
    };
  }

  return { level: "high", reason: null };
}

/**
 * Result of a hybrid search — the ranked candidates plus a confidence
 * signal the caller can surface in the output. Issue #4.
 */
export interface HybridSearchResult {
  results: SearchResult[];
  confidence: "high" | "medium" | "low";
  confidenceReason: string | null;
  fallbackHint: string | null;
}

/**
 * Internal: compute the full ranked candidate list without packing.
 * Extracted so hybridSearch and hybridSearchWithConfidence both share
 * it — the original implementation ran this pipeline twice, once
 * inside hybridSearch (packed) and again implicitly when the
 * confidence wrapper called hybridSearch with a sky-high budget and
 * then repacked. That was doubling the work on every search call.
 *
 * Returns the full ranked list (not token-budgeted). Callers pack.
 */
async function rankCandidates(
  indexer: Indexer,
  options: SearchOptions
): Promise<SearchResult[]> {
  const { query, scope, language, type } = options;

  // Signal A: BM25 text search
  const ftsResults = indexer.chunkStore.searchFts(query, 50);

  // Signal B: Vector similarity search
  // Optimization: only scan vectors for FTS candidate files + top PageRank files
  // instead of ALL embeddings (O(n) brute force)
  const [queryVector] = await indexer.embed([query]);

  const candidateChunkIds = new Set<number>();

  // Add all FTS result chunk IDs
  for (const r of ftsResults) candidateChunkIds.add(r.id);

  // Add chunks from same files as FTS results (sibling functions matter)
  const ftsFileIds = new Set(ftsResults.map((r) => r.file_id));
  if (ftsFileIds.size > 0) {
    for (const fileId of ftsFileIds) {
      for (const chunk of indexer.chunkStore.getByFile(fileId)) {
        candidateChunkIds.add(chunk.id);
      }
    }
  }

  // Add chunks from top PageRank files (structurally important), cap total candidates
  const MAX_CANDIDATES = 500;
  const topFiles = indexer.fileStore.getAll().slice(0, 20); // already sorted by pagerank DESC
  for (const f of topFiles) {
    if (candidateChunkIds.size >= MAX_CANDIDATES) break;
    for (const chunk of indexer.chunkStore.getByFile(f.id)) {
      if (candidateChunkIds.size >= MAX_CANDIDATES) break;
      candidateChunkIds.add(chunk.id);
    }
  }

  // Only compute cosine similarity for candidate chunks (~100-500 vs thousands)
  const vectorScores: { chunkId: number; score: number }[] = [];
  for (const chunkId of candidateChunkIds) {
    const vec = indexer.embeddingStore.get(chunkId);
    if (!vec) continue;
    vectorScores.push({ chunkId, score: cosineSimilarity(queryVector, vec) });
  }

  vectorScores.sort((a, b) => b.score - a.score);
  const topVector = vectorScores.slice(0, 50);

  // Build file cache for PageRank lookup
  const fileCache = new Map<number, FileRecord>();
  for (const f of indexer.fileStore.getAll()) {
    fileCache.set(f.id, f);
  }

  // Reciprocal Rank Fusion
  const rrfScores = new Map<number, number>();

  // Add FTS scores
  for (let rank = 0; rank < ftsResults.length; rank++) {
    const chunkId = ftsResults[rank].id;
    const score = 1 / (RRF_K + rank + 1);
    rrfScores.set(chunkId, (rrfScores.get(chunkId) || 0) + score);
  }

  // Add vector scores
  for (let rank = 0; rank < topVector.length; rank++) {
    const chunkId = topVector[rank].chunkId;
    const score = 1 / (RRF_K + rank + 1);
    rrfScores.set(chunkId, (rrfScores.get(chunkId) || 0) + score);
  }

  // Collect candidates with full data
  const candidates: SearchResult[] = [];
  for (const [chunkId, rrfScore] of rrfScores) {
    const chunk = indexer.chunkStore.getById(chunkId);
    if (!chunk) continue;

    const file = fileCache.get(chunk.file_id);
    if (!file) continue;

    // Apply filters
    if (scope && !file.path.startsWith(scope)) continue;
    if (language && file.language !== language) continue;
    if (type && type !== "any" && chunk.type !== type) continue;

    // Boost by PageRank
    const pagerankBoost = 1 + 0.3 * file.pagerank;
    // Cheap structural boosts borrowed from fff.nvim. Each is ≤±40% so
    // they break ties without overwhelming the RRF + PageRank signal.
    const entryBoost = entryPointBonus(file.path);
    const suffixBoost = pathSuffixAlignmentBonus(query, file.path);
    const distancePenalty = currentFileDistancePenalty(file.path, options.currentFile);

    const finalScore =
      rrfScore * pagerankBoost * entryBoost * suffixBoost * distancePenalty;

    candidates.push({ chunk, file, score: finalScore });
  }

  // Sort by score, return unbounded — caller packs.
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

/**
 * Public entry point: returns the ranked+packed result list.
 * Backwards compat for any in-process callers that don't need the
 * confidence signal.
 */
export async function hybridSearch(
  indexer: Indexer,
  options: SearchOptions
): Promise<SearchResult[]> {
  const ranked = await rankCandidates(indexer, options);
  return packResults(ranked, options.tokenBudget);
}

/**
 * Same as hybridSearch but returns a confidence signal and a suggested
 * fallback hint. This is the preferred entry point for the MCP tool —
 * it lets us tell agents when semantic search is likely to be weak so
 * they can fall back to Grep without burning a second tool call.
 */
export async function hybridSearchWithConfidence(
  indexer: Indexer,
  options: SearchOptions
): Promise<HybridSearchResult> {
  // Single rank pass; confidence reads the unbounded list, the output
  // is packed to the caller's budget. No double work.
  const ranked = await rankCandidates(indexer, options);

  const shape = classifyQueryShape(options.query);
  const confidence = computeConfidence(ranked, shape);

  const packed = packResults(ranked, options.tokenBudget);

  // Fallback hint wording. Keep the hint specific to *what went wrong*
  // so the agent can act on it rather than staring at an "unsure" tag.
  let fallbackHint: string | null = null;
  if (confidence.level === "low") {
    if (shape.shape === "framework_wiring") {
      fallbackHint =
        "This query looks like a framework-wiring / registration question. " +
        "Semantic search struggles with these because the answer often lives " +
        "in a bean annotation, a config file, or a build-time-generated class. " +
        "Try Grep for the specific annotation pattern (e.g. `@Component`, " +
        "`@Configuration`, `@Inject`) or the framework-level class name.";
    } else if (ranked.length === 0) {
      fallbackHint =
        "No matches. The query may be out of distribution for the current " +
        "embedding model. Try rephrasing with concrete identifier names, or " +
        "fall back to `Grep` for exact string matching.";
    } else {
      fallbackHint =
        "Top result has a weak relevance score. Consider a more specific " +
        "query, or fall back to `Grep` if you know the exact symbol name.";
    }
  } else if (confidence.level === "medium" && shape.shape === "framework_wiring") {
    fallbackHint =
      "These results may be framework-wiring-adjacent. If none of the top " +
      "matches directly answer the question, grep for the specific annotation " +
      "(e.g. `@Configuration`, `@Component`) — that's often the faster path.";
  }

  return {
    results: packed,
    confidence: confidence.level,
    confidenceReason: confidence.reason,
    fallbackHint,
  };
}

export function packResults(
  candidates: SearchResult[],
  tokenBudget: number
): SearchResult[] {
  const results: SearchResult[] = [];
  let remaining = tokenBudget;
  let totalNeeded = 0;

  for (const candidate of candidates) {
    // Estimate overhead per result (file path, line numbers, formatting)
    const overhead = 30;
    const cost = candidate.chunk.token_count + overhead;
    totalNeeded += cost;

    if (cost <= remaining) {
      results.push(candidate);
      remaining -= cost;
    }
  }

  // Attach overflow metadata so formatResults can surface a budget hint.
  // We stash it on a non-enumerable property to avoid changing the
  // SearchResult type or the return signature (backwards compat).
  const overflow = candidates.length - results.length;
  if (overflow > 0) {
    (results as SearchResult[] & { __overflow?: { count: number; totalNeeded: number } }).__overflow = {
      count: overflow,
      totalNeeded,
    };
  }

  return results;
}

export function formatResults(
  results: SearchResult[],
  opts: { compact?: boolean } = {}
): string {
  if (results.length === 0) {
    return "No matches.";
  }

  // Compact mode (default): for chunks longer than ~15 lines, show signature
  // + first 4 lines + last line + an elision marker. 3-4× more results fit
  // in the same token budget — agents re-Read the full body when they need it.
  // Disable with `compact: false` for callers that genuinely need full bodies.
  const compact = opts.compact ?? true;
  const parts: string[] = [];

  for (const { chunk, file } of results) {
    const header = chunk.name
      ? `## ${file.path}:${chunk.start_line}-${chunk.end_line} (${chunk.type}: ${chunk.name})`
      : `## ${file.path}:${chunk.start_line}-${chunk.end_line} (${chunk.type})`;

    parts.push(header);
    parts.push(`\`\`\`${file.language || ""}`);

    const lines = chunk.content.split("\n");
    if (compact && lines.length > 15) {
      const head = lines.slice(0, 4);
      const tail = lines[lines.length - 1];
      parts.push(head.join("\n"));
      parts.push(`  // … ${lines.length - 5} lines elided — Read for full body …`);
      parts.push(tail);
    } else {
      parts.push(chunk.content);
    }

    parts.push("```");
    parts.push("");
  }

  // Surface budget hint when results were truncated by packResults
  const overflow = (results as SearchResult[] & { __overflow?: { count: number; totalNeeded: number } }).__overflow;
  if (overflow) {
    parts.push(
      `_+${overflow.count} more (~${overflow.totalNeeded} tok). Pass token_budget:${overflow.totalNeeded} for all._`
    );
  }

  return parts.join("\n");
}

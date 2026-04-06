import type { Indexer } from "../indexer/indexer.js";
import { embed, cosineSimilarity } from "../indexer/embedder.js";
import type { SearchResult, CodeChunk, FileRecord, ChunkType } from "../types/index.js";
import { log } from "../utils/logger.js";

interface SearchOptions {
  query: string;
  tokenBudget: number;
  scope?: string;
  language?: string;
  type?: ChunkType | "any";
}

// Reciprocal Rank Fusion constant
const RRF_K = 60;

export async function hybridSearch(
  indexer: Indexer,
  options: SearchOptions
): Promise<SearchResult[]> {
  const { query, tokenBudget, scope, language, type } = options;

  // Signal A: BM25 text search
  const ftsResults = indexer.chunkStore.searchFts(query, 50);

  // Signal B: Vector similarity search
  const [queryVector] = await embed([query]);
  const allEmbeddings = indexer.embeddingStore.getAll();
  const vectorScores: { chunkId: number; score: number }[] = [];

  for (const [chunkId, vec] of allEmbeddings) {
    const score = cosineSimilarity(queryVector, vec);
    vectorScores.push({ chunkId, score });
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
    const finalScore = rrfScore * pagerankBoost;

    candidates.push({ chunk, file, score: finalScore });
  }

  // Sort by score
  candidates.sort((a, b) => b.score - a.score);

  // Pack into token budget
  return packResults(candidates, tokenBudget);
}

export function packResults(
  candidates: SearchResult[],
  tokenBudget: number
): SearchResult[] {
  const results: SearchResult[] = [];
  let remaining = tokenBudget;

  for (const candidate of candidates) {
    // Estimate overhead per result (file path, line numbers, formatting)
    const overhead = 30;
    const cost = candidate.chunk.token_count + overhead;

    if (cost <= remaining) {
      results.push(candidate);
      remaining -= cost;
    } else if (remaining < 100) {
      break;
    }
  }

  return results;
}

export function formatResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return "No results found.";
  }

  const parts: string[] = [];

  for (const { chunk, file, score } of results) {
    const header = chunk.name
      ? `## ${file.path}:${chunk.start_line}-${chunk.end_line} (${chunk.type}: ${chunk.name})`
      : `## ${file.path}:${chunk.start_line}-${chunk.end_line} (${chunk.type})`;

    parts.push(header);
    parts.push(`\`\`\`${file.language || ""}`);
    parts.push(chunk.content);
    parts.push("```");
    parts.push("");
  }

  return parts.join("\n");
}

// Context bundling (v0.14, P1-13). For each top-k hit returned by
// sverklo_search, optionally attach up to N adjacent chunks from the
// same file + one hop along the import graph — bounded by a token
// budget so output size stays predictable.
//
// This is strictly output-side: ranking is unchanged, result order is
// unchanged. The bundle extends each hit's context so the agent gets
// richer grounding without having to fire follow-up Read / refs calls.

import type { SearchResult, CodeChunk, FileRecord } from "../types/index.js";
import type { Indexer } from "../indexer/indexer.js";
import { estimateTokens } from "../utils/tokens.js";

export interface BundleOptions {
  /** Token budget for the total extra context attached across all hits. */
  tokenBudget: number;
  /** Max adjacent chunks per hit (default 2). */
  maxAdjacentPerHit?: number;
  /** Max 1-hop neighbor chunks per hit (default 1). */
  maxNeighborsPerHit?: number;
}

export interface BundledHit {
  result: SearchResult;
  adjacents: CodeChunk[];       // chunks in the same file, nearest first
  neighbors: Array<{ chunk: CodeChunk; file: FileRecord }>; // 1-hop via imports
}

export interface BundleOutput {
  bundled: BundledHit[];
  tokensUsed: number;
  tokensBudget: number;
}

/**
 * Given a list of search results, enrich each with adjacent + neighbor
 * chunks up to the token budget. Walks hits in rank order; once the
 * budget is exhausted, remaining hits keep their original (empty) bundle.
 */
export function bundleResults(
  indexer: Indexer,
  results: SearchResult[],
  opts: BundleOptions
): BundleOutput {
  const maxAdj = opts.maxAdjacentPerHit ?? 2;
  const maxNeigh = opts.maxNeighborsPerHit ?? 1;
  const budget = opts.tokenBudget;

  // Files we've already attached per-hit — dedupes cross-hit bundling so
  // a single big module doesn't get pulled in twice.
  const seenChunkIds = new Set<number>(results.map((r) => r.chunk.id));

  let tokensUsed = 0;
  const bundled: BundledHit[] = [];

  for (const result of results) {
    const hit: BundledHit = { result, adjacents: [], neighbors: [] };

    if (tokensUsed < budget) {
      // Adjacent chunks — the 1-2 chunks immediately above & below the hit
      // in the same file, sorted by proximity (abs distance from hit center).
      const fileChunks = indexer.chunkStore.getByFile(result.file.id);
      const hitMid = (result.chunk.start_line + result.chunk.end_line) / 2;
      const candidates = fileChunks
        .filter((c) => !seenChunkIds.has(c.id))
        .map((c) => ({
          chunk: c,
          dist: Math.abs((c.start_line + c.end_line) / 2 - hitMid),
        }))
        .sort((a, b) => a.dist - b.dist);

      for (const { chunk } of candidates) {
        if (hit.adjacents.length >= maxAdj) break;
        const cost = chunkCost(chunk);
        if (tokensUsed + cost > budget) break;
        hit.adjacents.push(chunk);
        seenChunkIds.add(chunk.id);
        tokensUsed += cost;
      }

      // 1-hop neighbors via the import graph. We pull chunks from files
      // the hit imports (or is imported by), picking the highest-PageRank
      // chunk per neighbor file.
      if (tokensUsed < budget && maxNeigh > 0) {
        const outbound = indexer.graphStore.getImports(result.file.id);
        const inbound = indexer.graphStore.getImporters(result.file.id);
        const neighborFileIds = new Set<number>([
          ...outbound.map((e) => e.target_file_id),
          ...inbound.map((e) => e.source_file_id),
        ]);

        let taken = 0;
        for (const nfId of neighborFileIds) {
          if (taken >= maxNeigh) break;
          const nfile = indexer.fileStore.getAll().find((f) => f.id === nfId);
          if (!nfile) continue;
          const neighborChunks = indexer.chunkStore.getByFile(nfId);
          if (neighborChunks.length === 0) continue;
          // Pick the longest-named chunk as a rough proxy for "entry point"
          // — we don't have per-chunk PageRank but longer symbol names
          // correlate with public API surface in practice.
          const pick = neighborChunks
            .filter((c) => !seenChunkIds.has(c.id))
            .sort((a, b) => (b.name?.length ?? 0) - (a.name?.length ?? 0))[0];
          if (!pick) continue;
          const cost = chunkCost(pick);
          if (tokensUsed + cost > budget) break;
          hit.neighbors.push({ chunk: pick, file: nfile });
          seenChunkIds.add(pick.id);
          tokensUsed += cost;
          taken++;
        }
      }
    }

    bundled.push(hit);
  }

  return { bundled, tokensUsed, tokensBudget: budget };
}

function chunkCost(chunk: CodeChunk): number {
  // Conservative: signature header + body length. Falls back to content
  // token estimate when no signature.
  return Math.max(20, estimateTokens(chunk.content));
}

/**
 * Render the bundle block for a single hit — formatted as sub-sections
 * under the main result header. Returns an empty string when there's
 * nothing to add.
 */
export function formatBundle(hit: BundledHit): string {
  const parts: string[] = [];
  if (hit.adjacents.length > 0) {
    parts.push("");
    parts.push("_Adjacent in file:_");
    for (const c of hit.adjacents) {
      const name = c.name ? `: ${c.name}` : "";
      parts.push(
        `  - ${hit.result.file.path}:${c.start_line}-${c.end_line} [${c.type}${name}]`
      );
    }
  }
  if (hit.neighbors.length > 0) {
    parts.push("");
    parts.push("_Graph neighbors (1-hop):_");
    for (const n of hit.neighbors) {
      const name = n.chunk.name ? `: ${n.chunk.name}` : "";
      parts.push(
        `  - ${n.file.path}:${n.chunk.start_line}-${n.chunk.end_line} [${n.chunk.type}${name}]`
      );
    }
  }
  return parts.join("\n");
}

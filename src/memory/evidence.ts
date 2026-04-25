import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Indexer } from "../indexer/indexer.js";
import type { Evidence, RetrievalMethod, VerifyResult, CodeChunk } from "../types/index.js";
import { getGitState } from "./git-state.js";
import {
  hashSpan,
  spanSimilarity,
  type StoredEvidence,
} from "../storage/evidence-store.js";

// 5s TTL on git SHA — avoids shelling out per evidence-create. The file
// watcher in the indexer is independent; this is a pragmatic cache on the
// read side.
const SHA_CACHE_MS = 5_000;
let __shaCache: { sha: string | null; ts: number; root: string } | null = null;

function cachedGitSha(rootPath: string): string | null {
  if (__shaCache && __shaCache.root === rootPath && Date.now() - __shaCache.ts < SHA_CACHE_MS) {
    return __shaCache.sha;
  }
  const state = getGitState(rootPath);
  __shaCache = { sha: state.sha, ts: Date.now(), root: rootPath };
  return state.sha;
}

export interface CreateEvidenceInput {
  chunk: CodeChunk;
  file: { path: string };
  method: RetrievalMethod;
  score: number;
}

/**
 * Persist an Evidence row for a single retrieval hit and return the public
 * shape. Uses the chunk's own `content` (already in SQLite) for hashing so
 * there's no filesystem read on the hot path.
 */
export function createEvidence(
  indexer: Indexer,
  input: CreateEvidenceInput
): Evidence {
  const sha = cachedGitSha(indexer.rootPath);
  const id = indexer.evidenceStore.insert({
    file: input.file.path,
    start_line: input.chunk.start_line,
    end_line: input.chunk.end_line,
    commit_sha: sha,
    chunk_id: input.chunk.id,
    symbol: input.chunk.name,
    method: input.method,
    score: input.score,
    content_hash: hashSpan(input.chunk.content),
  });
  return {
    id,
    file: input.file.path,
    lines: [input.chunk.start_line, input.chunk.end_line],
    sha,
    chunk_id: input.chunk.id,
    symbol: input.chunk.name ?? undefined,
    method: input.method,
    score: input.score,
  };
}

/**
 * Verify an evidence id: reads the span at the current HEAD and classifies
 * the outcome. The stored content_hash is the truth; the classifier walks
 * a window around the original line range to detect a "moved" case.
 */
export function verifyEvidence(indexer: Indexer, evidenceId: string): VerifyResult {
  const row: StoredEvidence | null = indexer.evidenceStore.getById(evidenceId);
  if (!row) {
    return {
      id: evidenceId,
      status: "deleted",
      note: `evidence id ${evidenceId} not found (TTL expired or never created)`,
    };
  }

  const abs = join(indexer.rootPath, row.file);
  if (!existsSync(abs)) {
    return { id: evidenceId, status: "file_missing", file: row.file };
  }

  const content = readFileSync(abs, "utf-8");
  const fileLines = content.split("\n");
  const originalStart = Math.max(0, row.start_line - 1);
  const originalEnd = Math.min(fileLines.length, row.end_line);
  const currentAtOriginal = fileLines.slice(originalStart, originalEnd).join("\n");

  // Fast path: identical bytes at the same lines.
  if (hashSpan(currentAtOriginal) === row.content_hash) {
    return {
      id: evidenceId,
      status: "unchanged",
      file: row.file,
      current_lines: [row.start_line, row.end_line],
    };
  }

  // Scan a window around the original range for a matching span. A hash
  // match at a different offset = "moved". Track best-similarity in the
  // same pass so we can classify modified-in-place if the hash-scan misses.
  const spanLen = row.end_line - row.start_line + 1;
  const scanFrom = Math.max(0, row.start_line - spanLen * 2 - 1);
  const scanTo = Math.min(fileLines.length - spanLen, row.end_line + spanLen * 2);
  let bestSim = spanSimilarity(currentAtOriginal, currentAtOriginal); // 1.0 self; placeholder
  // We don't have the original text, only its hash. Similarity must be
  // computed against a *candidate* span using the chunk-store, not against
  // the stored row. Fall back to "modified" when hash differs but the
  // current-range span still looks structurally similar (token count within
  // 30% of the original chunk length estimate).
  let bestSimStart = -1;

  for (let s = scanFrom; s <= scanTo; s++) {
    const candidate = fileLines.slice(s, s + spanLen).join("\n");
    if (hashSpan(candidate) === row.content_hash) {
      return {
        id: evidenceId,
        status: "moved",
        file: row.file,
        current_lines: [s + 1, s + spanLen],
        similarity: 1,
      };
    }
    // Rough similarity: compare the candidate's token set to a reference
    // we can recover — the chunk, if still cached in the chunk store.
    // When the chunk is gone we use the current-at-original span, which
    // at least tells us if anything in the local neighborhood resembles
    // what's now at the pinned lines.
    const ref = indexer.chunkStore.getById(row.chunk_id ?? -1)?.content ?? currentAtOriginal;
    const sim = spanSimilarity(candidate, ref);
    if (sim > bestSim || bestSimStart < 0) {
      bestSim = sim;
      bestSimStart = s;
    }
  }

  // No hash match anywhere in the window. Classify based on similarity.
  if (bestSim >= 0.75) {
    const moved = bestSimStart >= 0 && bestSimStart !== originalStart;
    return {
      id: evidenceId,
      status: moved ? "moved" : "modified",
      file: row.file,
      current_lines:
        moved && bestSimStart >= 0
          ? [bestSimStart + 1, bestSimStart + spanLen]
          : [row.start_line, row.end_line],
      similarity: Number(bestSim.toFixed(2)),
    };
  }

  return {
    id: evidenceId,
    status: "deleted",
    file: row.file,
    note: "span no longer found in file",
    similarity: Number(bestSim.toFixed(2)),
  };
}

/**
 * Render a list of Evidence as the JSON footer appended to tool responses.
 * Consumers ignoring the footer see a fenced code block they can skip;
 * structured consumers parse `evidence_ids` out.
 */
export function renderEvidenceFooter(list: Evidence[]): string {
  if (list.length === 0) return "";
  const json = JSON.stringify(list);
  return `\n\n\`\`\`evidence\n${json}\n\`\`\``;
}

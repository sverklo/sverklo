import type { Indexer } from "../indexer/indexer.js";
import type { CodeChunk, FileRecord, Evidence, RetrievalMethod } from "../types/index.js";
import { createEvidence } from "./evidence.js";

// Per-tool Evidence emission helper (Q4 / v0.15-rc).
//
// Search-family tools call `emitForHits` with their list of hits + the
// retrieval method that produced them. Each hit gets its own Evidence row
// (so individual citations can be verified) and the helper returns a
// fenced ```evidence-list footer the dispatcher appends.
//
// We deliberately bound emission per call (default 16) — even a 100-hit
// response only needs evidence for the entries the agent will actually
// cite. The agent can request more by re-running the tool with a higher
// `evidence_budget` arg if introduced later.

export interface EvidenceHit {
  chunk: CodeChunk;
  file: { path: string };
  score: number;
}

export function emitForHits(
  indexer: Indexer,
  hits: EvidenceHit[],
  method: RetrievalMethod,
  cap = 16
): { footer: string; evidence: Evidence[] } {
  if (hits.length === 0) return { footer: "", evidence: [] };
  const list: Evidence[] = [];
  for (const h of hits.slice(0, cap)) {
    list.push(createEvidence(indexer, { chunk: h.chunk, file: h.file, method, score: h.score }));
  }
  // The footer is a small JSON array embedded in a fenced block. Existing
  // text MCP consumers ignore it; structured consumers parse evidence_ids
  // out of `evidence-list` blocks.
  const json = JSON.stringify(
    list.map((e) => ({
      id: e.id,
      file: e.file,
      lines: e.lines,
      symbol: e.symbol ?? null,
      method: e.method,
    }))
  );
  return {
    footer: `\n\n\`\`\`evidence-list\n${json}\n\`\`\``,
    evidence: list,
  };
}

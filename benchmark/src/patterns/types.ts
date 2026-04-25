// Pattern-annotation eval (v0.15-rc.2 / Sprint 8).
//
// We label sverklo's own well-known classes/functions with the design
// pattern we expect the LLM tagger to produce. The eval reads back what
// `sverklo enrich-patterns` actually wrote and reports precision /
// recall against the manual ground truth.
//
// JSONL one entry per symbol:
//   {
//     "symbol": "EvidenceStore",
//     "file": "src/storage/evidence-store.ts",
//     "expected": ["repository"]      // patterns we want the labeler to emit
//   }

export interface PatternTask {
  symbol: string;
  file: string;
  expected: string[]; // closed taxonomy patterns
  /** Optional: patterns we explicitly DON'T want (false-positive guards). */
  forbidden?: string[];
}

export interface PatternScore {
  symbol: string;
  file: string;
  expected: string[];
  forbidden: string[];
  found: string[];          // pattern names actually written by the labeler
  recall: number;           // |expected ∩ found| / |expected|
  precision: number;        // |expected ∩ found| / |found|  (1.0 when found is empty)
  forbidden_hits: number;   // count of forbidden patterns that DID get tagged
}

export interface PatternRunSummary {
  total_tasks: number;
  scored_tasks: number;     // skipped if labeler hadn't tagged the symbol
  avg_recall: number;
  avg_precision: number;
  forbidden_hits_total: number;
  scores: PatternScore[];
}

// Research-style eval (v0.14, P1-10).
//
// Primitive tasks (P1/P2/P4/P5 in ../types.ts) check a single deterministic
// answer. Research tasks are different: the question is open-ended, the
// answer is a *set of required evidence spans*, and we score on recall of
// that set plus how efficiently we got there.
//
// Ground-truth format (JSONL, one object per line):
//
//   {
//     "id": "sverklo-rrf-retrieval",
//     "dataset": "sverklo",
//     "question": "How does sverklo fuse BM25, vector, and PageRank into one rank?",
//     "required_evidence": [
//       { "file": "src/search/hybrid-search.ts" },
//       { "file": "src/search/hybrid-search.ts", "symbol": "rankCandidates" }
//     ]
//   }

export interface RequiredEvidence {
  /** Repo-relative file path. Required. */
  file: string;
  /** Optional symbol name the answer must touch within the file. */
  symbol?: string;
  /** Optional line range; when present, scoring prefers hits whose
   * start/end overlap this window. */
  line_range?: [number, number];
}

export interface ResearchTask {
  id: string;
  dataset: string;
  question: string;
  required_evidence: RequiredEvidence[];
  /** Optional free-text note for the human authoring ground truth. */
  note?: string;
}

export interface ResearchHit {
  file: string;
  symbol?: string | null;
  start_line: number;
  end_line: number;
  score: number;
}

export interface ResearchScore {
  task_id: string;
  /** recall = matched required / |required|. 1.0 = all evidence surfaced. */
  recall: number;
  /** total hits returned — higher ≠ better on its own. */
  total_hits: number;
  /** hits that matched no required-evidence row — "wasted". */
  wasted_hits: number;
  /** matched required evidence (the ones we did cover). */
  matched: RequiredEvidence[];
  /** missed required evidence. */
  missed: RequiredEvidence[];
  /** latency for the investigate call. */
  duration_ms: number;
}

export interface ResearchRunSummary {
  dataset: string;
  total_tasks: number;
  avg_recall: number;
  perfect_recall: number;           // count of tasks with recall = 1.0
  avg_wasted_hits: number;
  avg_duration_ms: number;
  scores: ResearchScore[];
}

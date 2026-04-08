/**
 * Sverklo Benchmark Harness v2 — types
 *
 * Tier A primitives: focused, deterministic tasks where ground truth
 * is exactly enumerable. No agent loops; this measures the *primitives*
 * each baseline gives an LLM, not end-to-end task completion.
 */

export type TaskCategory = "P1" | "P2" | "P4" | "P5";

/**
 * P1: symbol definition lookup
 *   query: symbol name
 *   answer: list of (file, line) where the symbol is defined (usually 1)
 *
 * P2: reference finding
 *   query: symbol name
 *   answer: list of (file, line) callsites (excludes the def itself)
 *
 * P4: file dependencies
 *   query: file path
 *   answer: { imports: file[], importers: file[] }
 *
 * P5: dead code
 *   query: (none — dataset-wide)
 *   answer: list of exported symbol names with zero refs
 */
export interface Task {
  id: string;
  category: TaskCategory;
  dataset: string;
  // Free-form query payload (interpretation depends on category)
  query: string;
  // Optional secondary payload, e.g. expected symbol type for P1
  hint?: string;
  // Ground-truth answer
  expected: ExpectedAnswer;
}

export type ExpectedAnswer =
  | { kind: "locations"; locations: Location[] }
  | { kind: "deps"; imports: string[]; importers: string[] }
  | { kind: "names"; names: string[] };

export interface Location {
  file: string;   // repo-relative path
  line: number;   // 1-based
}

export interface RunMetrics {
  input_tokens: number;        // estimated from baseline response payloads
  tool_calls: number;
  wall_time_ms: number;
  cold_start_ms: number;
  warm_call_ms: number;
  // Quality
  recall: number;              // 0..1
  precision: number;           // 0..1
  f1: number;
  exact_match: boolean;        // for P1 only
  // Derived
  tokens_per_correct_answer: number; // input_tokens / max(recall, 0.01)
  // Debugging
  raw_payload_chars?: number;
  notes?: string;
}

export interface RunResult {
  task_id: string;
  category: TaskCategory;
  dataset: string;
  baseline: string;
  metrics: RunMetrics;
  predicted_summary?: string;
}

export interface Dataset {
  name: string;
  rootPath: string;
  // pinned SHA, optional for local checkouts
  sha?: string;
}

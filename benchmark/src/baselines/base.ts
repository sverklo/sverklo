import type { Task, RunMetrics, ExpectedAnswer } from "../types.ts";

/**
 * A Baseline answers a Task. It returns:
 *   - a structured prediction (so the scorer can compute recall/precision)
 *   - the raw concatenated payload it would have shown an LLM (so we can
 *     count tokens honestly — including grep noise, file contents, etc.)
 *   - tool/syscall counts and timing
 *
 * Cold-start vs warm-call: many baselines (sverklo) need an index built
 * once per dataset. Baselines should report this via setupForDataset.
 */
export interface Baseline {
  name: string;
  setupForDataset(dataset: { name: string; rootPath: string }): Promise<void>;
  teardownForDataset?(): Promise<void>;
  run(task: Task): Promise<BaselineOutput>;
}

export interface BaselineOutput {
  prediction: ExpectedAnswer;
  rawPayload: string;          // what the LLM would see
  toolCalls: number;
  wallTimeMs: number;
  coldStartMs: number;         // amortized; baselines may report 0 after first task
  warmCallMs: number;          // wallTimeMs minus cold start
  notes?: string;
}

export function emptyMetrics(): RunMetrics {
  return {
    input_tokens: 0,
    tool_calls: 0,
    wall_time_ms: 0,
    cold_start_ms: 0,
    warm_call_ms: 0,
    recall: 0,
    precision: 0,
    f1: 0,
    exact_match: false,
    tokens_per_correct_answer: 0,
  };
}

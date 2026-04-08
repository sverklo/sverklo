import type { ExpectedAnswer, Location, Task, RunMetrics } from "../types.ts";
import { estimateTokens } from "../estimator.ts";
import type { BaselineOutput } from "../baselines/base.ts";

/**
 * Scoring rules — deliberately lenient on paths, strict on content.
 *
 *   P1 (def lookup): exact_match = predicted (file, line) equals any
 *     expected (file, line) with a ±3-line tolerance (parsers disagree
 *     on "def line" — signature line vs function body line).
 *     recall/precision collapse to {0,1}.
 *
 *   P2 (references): bag-of-(file, line) with ±2-line tolerance.
 *     Baseline may return duplicates; we dedupe first.
 *
 *   P4 (deps): two sets (imports, importers) using normalized paths
 *     (strip ./, .ts, .js). f1 is the harmonic mean of per-side f1s.
 *
 *   P5 (orphans): set of names. This is the category where sverklo's
 *     semantic advantage matters least — grep can also do it — so we
 *     keep scoring identical.
 */
export function score(task: Task, predicted: ExpectedAnswer, bo: BaselineOutput): RunMetrics {
  const exp = task.expected;
  let recall = 0, precision = 0, exactMatch = false;

  if (exp.kind === "locations" && predicted.kind === "locations") {
    const tol = task.category === "P1" ? 3 : 2;
    const expSet = normLocs(exp.locations);
    const predSet = dedupeLocs(normLocs(predicted.locations));

    if (task.category === "P1") {
      const hit = predSet.some((p) => expSet.some((e) => sameLoc(p, e, tol)));
      exactMatch = hit;
      recall = hit ? 1 : 0;
      precision = predSet.length === 0 ? 0 : (hit ? 1 : 0);
    } else {
      // P2: every expected loc that has any predicted match
      const matched = expSet.filter((e) => predSet.some((p) => sameLoc(p, e, tol))).length;
      const correctPreds = predSet.filter((p) => expSet.some((e) => sameLoc(p, e, tol))).length;
      recall = expSet.length === 0 ? 1 : matched / expSet.length;
      precision = predSet.length === 0 ? 0 : correctPreds / predSet.length;
    }
  } else if (exp.kind === "deps" && predicted.kind === "deps") {
    const normalize = (arr: string[]) => new Set(arr.map(normPath));
    const { r: r1, p: p1 } = setScore(normalize(predicted.imports), normalize(exp.imports));
    const { r: r2, p: p2 } = setScore(normalize(predicted.importers), normalize(exp.importers));
    recall = (r1 + r2) / 2;
    precision = (p1 + p2) / 2;
  } else if (exp.kind === "names" && predicted.kind === "names") {
    // For P5, ground truth is "any of these are legitimate dead code
    // candidates". We score as set overlap.
    const expSet = new Set(exp.names);
    const predSet = new Set(predicted.names);
    const { r, p } = setScore(predSet, expSet);
    recall = r;
    precision = p;
  }

  const f1 = (recall + precision === 0) ? 0 : (2 * recall * precision) / (recall + precision);
  const input_tokens = estimateTokens(bo.rawPayload);
  const tokens_per_correct_answer = input_tokens / Math.max(recall, 0.01);

  return {
    input_tokens,
    tool_calls: bo.toolCalls,
    wall_time_ms: bo.wallTimeMs,
    cold_start_ms: bo.coldStartMs,
    warm_call_ms: bo.warmCallMs,
    recall,
    precision,
    f1,
    exact_match: exactMatch,
    tokens_per_correct_answer,
    raw_payload_chars: bo.rawPayload.length,
    notes: bo.notes,
  };
}

function normLocs(ls: Location[]): Location[] {
  return ls.map((l) => ({ file: normPath(l.file), line: l.line }));
}

function dedupeLocs(ls: Location[]): Location[] {
  const seen = new Set<string>();
  const out: Location[] = [];
  for (const l of ls) {
    const k = `${l.file}:${l.line}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(l);
  }
  return out;
}

function sameLoc(a: Location, b: Location, tol: number): boolean {
  return a.file === b.file && Math.abs(a.line - b.line) <= tol;
}

export function normPath(p: string): string {
  return p
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .replace(/\\/g, "/")
    .replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "");
}

function setScore(pred: Set<string>, exp: Set<string>): { r: number; p: number } {
  if (exp.size === 0 && pred.size === 0) return { r: 1, p: 1 };
  if (exp.size === 0) return { r: 1, p: 0 };
  if (pred.size === 0) return { r: 0, p: 0 };
  let tp = 0;
  for (const x of pred) if (exp.has(x)) tp++;
  return { r: tp / exp.size, p: tp / pred.size };
}

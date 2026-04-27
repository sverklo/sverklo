import { describe, it, expect } from "vitest";
import { scoreTask } from "./runner.ts";
import type { ResearchTask, ResearchHit } from "./types.ts";

function mkTask(required: ResearchTask["required_evidence"]): ResearchTask {
  return { id: "t", dataset: "d", question: "q?", required_evidence: required };
}

function hit(file: string, symbol?: string, s = 1, e = 10): ResearchHit {
  return { file, symbol: symbol ?? null, start_line: s, end_line: e, score: 0.5 };
}

describe("scoreTask", () => {
  it("recall 1.0 when every required file surfaces", () => {
    const task = mkTask([{ file: "a.ts" }, { file: "b.ts" }]);
    const hits = [hit("a.ts"), hit("b.ts"), hit("c.ts")];
    const score = scoreTask(task, hits, 10);
    expect(score.recall).toBe(1);
    expect(score.wasted_hits).toBe(1); // c.ts wasn't required
    expect(score.missed).toHaveLength(0);
  });

  it("partial recall when one evidence row is missing", () => {
    const task = mkTask([{ file: "a.ts" }, { file: "b.ts" }]);
    const hits = [hit("a.ts"), hit("z.ts"), hit("y.ts")];
    const score = scoreTask(task, hits, 10);
    expect(score.recall).toBeCloseTo(0.5, 5);
    expect(score.missed.map((m) => m.file)).toEqual(["b.ts"]);
  });

  it("requires symbol match when specified", () => {
    const task = mkTask([{ file: "a.ts", symbol: "target" }]);
    const hitWrongSymbol = [hit("a.ts", "other")];
    expect(scoreTask(task, hitWrongSymbol, 1).recall).toBe(0);

    const hitRightSymbol = [hit("a.ts", "target")];
    expect(scoreTask(task, hitRightSymbol, 1).recall).toBe(1);
  });

  it("respects line_range overlap when specified", () => {
    const task = mkTask([{ file: "a.ts", line_range: [50, 100] }]);
    // Hit outside range
    const miss = [hit("a.ts", null, 1, 20)];
    expect(scoreTask(task, miss, 1).recall).toBe(0);

    // Hit inside range
    const match = [hit("a.ts", null, 60, 90)];
    expect(scoreTask(task, match, 1).recall).toBe(1);
  });

  it("lets one hit satisfy multiple requirements when both specifiers match", () => {
    // A chunk in file a.ts with symbol 'x' satisfies BOTH a {file:a.ts}
    // requirement AND a {file:a.ts, symbol:x} requirement — they're not
    // independent claims, they're hierarchical.
    const task = mkTask([{ file: "a.ts" }, { file: "a.ts", symbol: "x" }]);
    const hits = [hit("a.ts", "x", 1, 10)];
    const score = scoreTask(task, hits, 1);
    expect(score.matched).toHaveLength(2);
    expect(score.missed).toHaveLength(0);
    expect(score.recall).toBe(1);
    // The hit covered both requirements so it isn't wasted.
    expect(score.wasted_hits).toBe(0);
  });

  it("MRR is 1.0 when every required file is at rank 1", () => {
    // Two requirements; first hit covers both because the symbol match also
    // satisfies the file-only requirement. Both reciprocal ranks = 1/1 = 1.
    const task = mkTask([{ file: "a.ts" }, { file: "a.ts", symbol: "x" }]);
    const hits = [hit("a.ts", "x", 1, 10)];
    const score = scoreTask(task, hits, 1);
    expect(score.mrr).toBe(1);
  });

  it("MRR penalises lower-ranked matches", () => {
    // Three required files, found at ranks 1, 5, and 10.
    // Per-file reciprocal ranks: 1/1, 1/5, 1/10. Mean = (1 + 0.2 + 0.1)/3 = 0.4333.
    const task = mkTask([{ file: "a.ts" }, { file: "b.ts" }, { file: "c.ts" }]);
    const hits = [
      hit("a.ts"),       // rank 1
      hit("noise1.ts"), hit("noise2.ts"), hit("noise3.ts"),
      hit("b.ts"),       // rank 5
      hit("noise4.ts"), hit("noise5.ts"), hit("noise6.ts"), hit("noise7.ts"),
      hit("c.ts"),       // rank 10
    ];
    const score = scoreTask(task, hits, 1);
    expect(score.recall).toBe(1);
    // (1 + 1/5 + 1/10) / 3 = 0.4333...
    expect(score.mrr).toBeCloseTo((1 + 0.2 + 0.1) / 3, 4);
  });

  it("MRR contributes 0 for missed required files", () => {
    // a.ts is at rank 1, b.ts is missing. MRR = (1 + 0)/2 = 0.5.
    const task = mkTask([{ file: "a.ts" }, { file: "b.ts" }]);
    const hits = [hit("a.ts"), hit("c.ts")];
    const score = scoreTask(task, hits, 1);
    expect(score.recall).toBeCloseTo(0.5, 5);
    expect(score.mrr).toBeCloseTo(0.5, 5);
  });

  it("MRR distinguishes a rank-30 result from a rank-5 result at equal recall", () => {
    // Both runs find the required file in top-50, so binary recall is 1.0
    // for both. MRR should reflect the rank improvement.
    const task = mkTask([{ file: "target.ts" }]);
    const noise = (n: number): ResearchHit[] => {
      const out: ResearchHit[] = [];
      for (let i = 0; i < n; i++) out.push(hit(`n${i}.ts`));
      return out;
    };

    const rank30Hits = [...noise(29), hit("target.ts")];
    const rank5Hits = [...noise(4), hit("target.ts")];

    const at30 = scoreTask(task, rank30Hits, 1);
    const at5 = scoreTask(task, rank5Hits, 1);

    expect(at30.recall).toBe(1);
    expect(at5.recall).toBe(1);
    expect(at30.mrr).toBeCloseTo(1 / 30, 5);
    expect(at5.mrr).toBeCloseTo(1 / 5, 5);
    expect(at5.mrr).toBeGreaterThan(at30.mrr);
  });
});

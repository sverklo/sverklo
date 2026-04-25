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
});

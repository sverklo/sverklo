import { describe, it, expect } from "vitest";
import {
  findUnguardedStreamCalls,
  parseUnifiedDiff,
  runAllHeuristics,
} from "./diff-heuristics.js";

// Regression tests for github.com/sverklo/sverklo/issues/5 — the diff
// review case that previously missed a class of production risk: a new
// call site introduced inside a stream pipeline with no enclosing
// try-catch. The heuristic is a proxy for the formal AST check we
// eventually want, and these tests lock in its behavior on the shapes
// we care about most.

describe("findUnguardedStreamCalls", () => {
  it("flags a new call added inside a .map() without try-catch", () => {
    // Realistic-shaped diff hunk: a production read path gains a new
    // helper call inside its stream pipeline. No try-catch anywhere
    // in the surrounding context — this is the bug we previously missed.
    const diffText = [
      "diff --git a/Service.java b/Service.java",
      "--- a/Service.java",
      "+++ b/Service.java",
      "@@ -10,5 +10,6 @@",
      " public List<Package> getAll() {",
      "   return repo.findAll().stream()",
      "     .map(p -> {",
      "+      var feat = computeFeatures(p);",
      "       return toDto(p);",
      "     })",
      "     .collect(Collectors.toList());",
      " }",
    ].join("\n");

    const hunks = parseUnifiedDiff(diffText);
    expect(hunks.length).toBeGreaterThan(0);

    const findings = findUnguardedStreamCalls(hunks);
    expect(findings.length).toBe(1);
    expect(findings[0].heuristic).toBe("unguarded-stream-call");
    expect(findings[0].file).toBe("Service.java");
    expect(findings[0].snippet).toContain("computeFeatures");
  });

  it("does NOT flag when a try-catch is visible in the hunk context", () => {
    // Same pattern, but the enclosing method catches its own exceptions.
    // The heuristic should back off — not perfect, but no false positive.
    const diffText = [
      "diff --git a/Service.java b/Service.java",
      "--- a/Service.java",
      "+++ b/Service.java",
      "@@ -10,7 +10,8 @@",
      " public List<Package> getAll() {",
      "   try {",
      "     return repo.findAll().stream()",
      "       .map(p -> {",
      "+        var feat = computeFeatures(p);",
      "         return toDto(p);",
      "       })",
      "       .collect(Collectors.toList());",
      "   } catch (Exception e) { return List.of(); }",
      " }",
    ].join("\n");

    const hunks = parseUnifiedDiff(diffText);
    const findings = findUnguardedStreamCalls(hunks);
    expect(findings.length).toBe(0);
  });

  it("does not flag added lines outside a stream pipeline", () => {
    const diffText = [
      "diff --git a/Util.ts b/Util.ts",
      "--- a/Util.ts",
      "+++ b/Util.ts",
      "@@ -1,5 +1,6 @@",
      " export function loadConfig() {",
      "   const raw = readFileSync('config.json');",
      "+  const parsed = JSON.parse(raw);",
      "   return raw;",
      " }",
    ].join("\n");

    const hunks = parseUnifiedDiff(diffText);
    const findings = findUnguardedStreamCalls(hunks);
    expect(findings.length).toBe(0);
  });

  it("flags at most once per stream block", () => {
    // Ten new calls inside one .map() should produce exactly one
    // finding, not ten. Noise control.
    const diffText = [
      "diff --git a/Batch.ts b/Batch.ts",
      "--- a/Batch.ts",
      "+++ b/Batch.ts",
      "@@ -1,5 +1,14 @@",
      " function processAll(items: Item[]) {",
      "   return items.map(it => {",
      "+    const a = transformA(it);",
      "+    const b = transformB(it);",
      "+    const c = transformC(it);",
      "+    const d = transformD(it);",
      "     return it;",
      "   });",
      " }",
    ].join("\n");

    const hunks = parseUnifiedDiff(diffText);
    const findings = findUnguardedStreamCalls(hunks);
    expect(findings.length).toBe(1);
  });

  it("handles .forEach and .flatMap the same way as .map", () => {
    const diffText = [
      "diff --git a/Listener.ts b/Listener.ts",
      "--- a/Listener.ts",
      "+++ b/Listener.ts",
      "@@ -1,4 +1,5 @@",
      " function broadcast(events: Event[]) {",
      "   events.forEach(e => {",
      "+    publishToQueue(e);",
      "   });",
      " }",
    ].join("\n");

    const hunks = parseUnifiedDiff(diffText);
    const findings = findUnguardedStreamCalls(hunks);
    expect(findings.length).toBe(1);
    expect(findings[0].snippet).toContain("publishToQueue");
  });
});

describe("runAllHeuristics", () => {
  it("returns empty array for empty hunks", () => {
    expect(runAllHeuristics([])).toEqual([]);
  });

  it("does not throw if a hunk has malformed lines", () => {
    // Sanity: a heuristic must never take down review even on weird input.
    expect(() =>
      runAllHeuristics([
        {
          filePath: "foo.ts",
          oldStart: 1,
          newStart: 1,
          lines: ["not-a-valid-diff-line", "+ok"],
        },
      ])
    ).not.toThrow();
  });
});

describe("parseUnifiedDiff", () => {
  it("extracts file path and hunk ranges from a standard git diff", () => {
    const text = [
      "diff --git a/src/foo.ts b/src/foo.ts",
      "index abc..def 100644",
      "--- a/src/foo.ts",
      "+++ b/src/foo.ts",
      "@@ -5,3 +5,4 @@",
      " context",
      "+added",
      " context",
      " context",
    ].join("\n");

    const hunks = parseUnifiedDiff(text);
    expect(hunks.length).toBe(1);
    expect(hunks[0].filePath).toBe("src/foo.ts");
    expect(hunks[0].oldStart).toBe(5);
    expect(hunks[0].newStart).toBe(5);
  });
});

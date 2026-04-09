import { describe, it, expect } from "vitest";
import { parseFile } from "./parser.js";

// Regression tests for github.com/sverklo/sverklo/issues/16.
//
// The TSJS parser used to assign `i = chunk.endLine` after pushing a
// chunk, but chunk.endLine is 1-indexed (set by extractChunk) while
// the loop's `i` is 0-indexed. After the `for (i++)`, the loop
// skipped one line past the chunk — which was the declaration of
// the NEXT top-level function in real files. So any file with two
// adjacent functions only ever got the first one indexed.
//
// The fix is `i = chunk.endLine - 1`. These tests cover the shape
// of codebases where the bug would bite: multiple adjacent top-level
// symbols, mixed types, and edge cases around blank lines and
// single-line functions.

describe("parseFile — TSJS multi-top-level regression (issue #16)", () => {
  it("indexes two adjacent single-line functions", () => {
    const content = [
      "function helper() { return 1; }",
      "export function run() { return helper(); }",
    ].join("\n");

    const result = parseFile(content, "typescript");
    const names = result.chunks.map((c) => c.name);
    expect(names).toContain("helper");
    expect(names).toContain("run");
  });

  it("indexes a function followed by a class", () => {
    const content = [
      "function helper() { return 1; }",
      "export class Service {",
      "  handle() { return 42; }",
      "}",
    ].join("\n");

    const result = parseFile(content, "typescript");
    const names = result.chunks.map((c) => c.name);
    expect(names).toContain("helper");
    expect(names).toContain("Service");
  });

  it("indexes a class followed by an interface", () => {
    const content = [
      "class A { run() {} }",
      "export interface B {",
      "  name: string;",
      "}",
    ].join("\n");

    const result = parseFile(content, "typescript");
    const names = result.chunks.map((c) => c.name);
    expect(names).toContain("A");
    expect(names).toContain("B");
  });

  it("indexes three sequential functions (helper, mid, end)", () => {
    // The original failure case is pairs. This catches any regression
    // where the fix accidentally only advances correctly once.
    const content = [
      "function helper() { return 1; }",
      "function mid() { return 2; }",
      "export function end() { return 3; }",
    ].join("\n");

    const result = parseFile(content, "typescript");
    const names = result.chunks.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["helper", "mid", "end"]));
    expect(result.chunks.length).toBeGreaterThanOrEqual(3);
  });

  it("handles blank lines between top-level declarations", () => {
    const content = [
      "function one() { return 1; }",
      "",
      "",
      "function two() { return 2; }",
      "",
      "function three() { return 3; }",
    ].join("\n");

    const result = parseFile(content, "typescript");
    const names = result.chunks.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["one", "two", "three"]));
  });

  it("preserves each chunk's own content without leaking neighbors", () => {
    const content = [
      "function alpha() { return 'a'; }",
      "function beta() { return 'b'; }",
    ].join("\n");

    const result = parseFile(content, "typescript");
    const alpha = result.chunks.find((c) => c.name === "alpha");
    const beta = result.chunks.find((c) => c.name === "beta");

    expect(alpha?.content).toContain("'a'");
    expect(alpha?.content).not.toContain("'b'");
    expect(beta?.content).toContain("'b'");
    expect(beta?.content).not.toContain("'a'");
  });

  it("handles multi-line functions correctly without skipping the next one", () => {
    const content = [
      "function first() {",
      "  const x = 1;",
      "  const y = 2;",
      "  return x + y;",
      "}",
      "function second() {",
      "  return 'hello';",
      "}",
    ].join("\n");

    const result = parseFile(content, "typescript");
    const names = result.chunks.map((c) => c.name);
    expect(names).toContain("first");
    expect(names).toContain("second");
  });

  it("handles arrow functions followed by function declarations", () => {
    const content = [
      "export const fetch = async () => { return null; };",
      "export function process() { return 42; }",
    ].join("\n");

    const result = parseFile(content, "typescript");
    const names = result.chunks.map((c) => c.name);
    expect(names).toContain("fetch");
    expect(names).toContain("process");
  });

  it("javascript (not just typescript) gets the fix", () => {
    // Same regex pipeline, same bug in v0.2.13 and earlier. Cover both.
    const content = [
      "function alpha() { return 1; }",
      "function beta() { return 2; }",
    ].join("\n");

    const result = parseFile(content, "javascript");
    const names = result.chunks.map((c) => c.name);
    expect(names).toContain("alpha");
    expect(names).toContain("beta");
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Indexer } from "../../indexer/indexer.js";
import { getProjectConfig } from "../../utils/config.js";
import { handleContext } from "./context.js";

// Tests for the sverklo_context --budget N repo-map mode (issue #8).
// These lock in the deterministic-ordering contract (same index +
// same budget = same output), the budget clamping behavior, and the
// exclude filter. We build a tiny real project so the tests exercise
// the actual PageRank + chunk iteration, not a mock.

describe("handleContext (budget mode)", () => {
  let tmpRoot: string;
  let indexer: Indexer;

  beforeEach(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "sverklo-context-budget-"));
    mkdirSync(join(tmpRoot, "src"), { recursive: true });
    mkdirSync(join(tmpRoot, "test"), { recursive: true });

    // Seed a few files with different sizes so PageRank has something
    // to differentiate. The exact rankings don't matter — we only
    // assert that output is stable and contains expected path markers.
    writeFileSync(
      join(tmpRoot, "src", "core.ts"),
      [
        "export function load() { return 1; }",
        "export function save() { return 2; }",
        "export function reset() { return 3; }",
      ].join("\n"),
      "utf-8"
    );
    writeFileSync(
      join(tmpRoot, "src", "helpers.ts"),
      [
        "import { load } from './core';",
        "export function helper1() { return load(); }",
        "export function helper2() { return load(); }",
      ].join("\n"),
      "utf-8"
    );
    writeFileSync(
      join(tmpRoot, "test", "core.test.ts"),
      [
        "export function runTests() { return 'all-green'; }",
        "export function setupSuite() { return {}; }",
      ].join("\n"),
      "utf-8"
    );

    const cfg = getProjectConfig(tmpRoot);
    indexer = new Indexer(cfg);
    await indexer.index();
  });

  afterEach(() => {
    try {
      indexer.close();
    } catch {}
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  });

  it("returns a repo-map-shaped response when budget is set", async () => {
    const out = await handleContext(indexer, { budget: 2000 });
    expect(out).toContain("# Repo map");
    expect(out).toContain("Budget: 2000 tokens");
    expect(out).toContain("PageRank");
  });

  it("produces identical output for identical inputs (determinism contract)", async () => {
    const a = await handleContext(indexer, { budget: 2000 });
    const b = await handleContext(indexer, { budget: 2000 });
    expect(a).toBe(b);
  });

  it("works without a task (pure PageRank ordering)", async () => {
    const out = await handleContext(indexer, { budget: 2000 });
    expect(out).not.toContain("centered on");
    expect(out).toContain("PageRank");
  });

  it("accepts a task parameter and advertises the bias in the header", async () => {
    const out = await handleContext(indexer, {
      budget: 2000,
      task: "understand loading logic",
    });
    expect(out).toContain("centered on: understand loading logic");
    expect(out).toContain("task relevance");
  });

  it("respects the exclude filter", async () => {
    const withTests = await handleContext(indexer, { budget: 4000, exclude: [] });
    const withoutTests = await handleContext(indexer, {
      budget: 4000,
      exclude: ["test"],
    });

    // The test file should appear in the unfiltered version but not
    // in the filtered one.
    expect(withTests).toContain("core.test.ts");
    expect(withoutTests).not.toContain("core.test.ts");
  });

  it("clamps budgets above the max and emits a warning line", async () => {
    const out = await handleContext(indexer, { budget: 100_000 });
    expect(out).toContain("clamped");
    // The stated budget in the header should be the clamp ceiling,
    // not the original request.
    expect(out).toContain("32000");
  });

  it("rejects budgets below the minimum with a helpful message", async () => {
    const out = await handleContext(indexer, { budget: 100 });
    expect(out).toContain("Budget too small");
    expect(out).toContain("Minimum");
  });

  it("scope filter restricts the map to matching paths", async () => {
    const out = await handleContext(indexer, { budget: 2000, scope: "src/" });
    expect(out).toContain("src/");
    expect(out).not.toContain("test/core.test.ts");
  });

  it("reports a footer with rendered count and remaining-files hint", async () => {
    const out = await handleContext(indexer, { budget: 2000 });
    // "Rendered N of M files" footer is always present when the mode
    // ran to completion.
    expect(out).toMatch(/Rendered \d+ of \d+ files/);
  });

  it("falls back gracefully when task search fails internally", async () => {
    // Even if search blows up, the map must still render in pure
    // PageRank mode rather than returning an error. We can't easily
    // force hybridSearch to throw here without monkey-patching, so
    // we assert the contract indirectly: a task with zero meaningful
    // matches should still produce a valid map.
    const out = await handleContext(indexer, {
      budget: 2000,
      task: "zzzzz totally unrelated gibberish query",
    });
    expect(out).toContain("# Repo map");
    expect(out).toMatch(/Rendered \d+ of \d+ files/);
  });
});

// Separate suite: error / missing-task behavior when budget is NOT set.
describe("handleContext (non-budget mode)", () => {
  let tmpRoot: string;
  let indexer: Indexer;

  beforeEach(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "sverklo-context-nobudget-"));
    mkdirSync(join(tmpRoot, "src"), { recursive: true });
    writeFileSync(join(tmpRoot, "src", "a.ts"), "export const a = 1;\n", "utf-8");

    const cfg = getProjectConfig(tmpRoot);
    indexer = new Indexer(cfg);
    await indexer.index();
  });

  afterEach(() => {
    try {
      indexer.close();
    } catch {}
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  });

  it("still requires a task when budget is not set", async () => {
    const out = await handleContext(indexer, {});
    expect(out).toContain("required");
  });
});

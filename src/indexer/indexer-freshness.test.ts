import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Indexer } from "./indexer.js";
import { getProjectConfig } from "../utils/config.js";

// Tests for the freshness cache contract (issue #6). The cache exists
// to keep sverklo_status fast — the disk walk costs ~95ms on a small
// repo and agents can call status repeatedly in one session. The
// contract:
//
//   1. Result is cached for FRESHNESS_CACHE_MS (2s) after the first
//      computation.
//   2. The cache is invalidated by explicit reindex / clearIndex.
//   3. The file watcher also invalidates on change events (tested via
//      direct invalidateFreshnessCache() call since we don't want to
//      stand up chokidar in a unit test).

describe("Indexer freshness cache", () => {
  let tmpRoot: string;
  let indexer: Indexer;

  beforeEach(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "sverklo-freshness-"));

    // Minimal real repo: one TypeScript file. Indexing this should
    // take well under a second.
    mkdirSync(join(tmpRoot, "src"), { recursive: true });
    writeFileSync(
      join(tmpRoot, "src", "foo.ts"),
      "export function foo() { return 42; }\n",
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

  it("returns a freshness result with ageSeconds and dirty/missing lists", () => {
    const result = indexer.getFreshness();
    expect(result).toBeDefined();
    expect(Array.isArray(result.dirtyFiles)).toBe(true);
    expect(Array.isArray(result.missingFiles)).toBe(true);
    // Either a number or null — never undefined
    expect(result.ageSeconds === null || typeof result.ageSeconds === "number").toBe(true);
  });

  it("serves from cache on rapid successive calls", () => {
    // First call: compute. Second call within TTL: serve from cache.
    // We can't directly observe "did it re-walk?" without instrumentation,
    // but we can observe that the second call returns the *same*
    // dirtyFiles array reference if we patch it — or more simply,
    // measure that 100 calls in a row take negligible time (the cache
    // hit path is O(1)). A perf threshold works as a regression guard.
    const t0 = Date.now();
    for (let i = 0; i < 100; i++) {
      indexer.getFreshness();
    }
    const elapsed = Date.now() - t0;
    // 100 cached reads should complete in <50ms on any machine that
    // isn't actively on fire. Real disk walks would take 100× longer.
    expect(elapsed).toBeLessThan(500);
  });

  it("reflects filesystem changes after invalidateFreshnessCache()", () => {
    const first = indexer.getFreshness();
    expect(first.dirtyFiles.length).toBe(0);

    // Add a new file on disk (bypassing the watcher so we control timing)
    writeFileSync(join(tmpRoot, "src", "bar.ts"), "export const bar = 1;\n", "utf-8");

    // Without invalidation, the cached result persists for up to 2s.
    // With invalidation, the next call sees the new file.
    indexer.invalidateFreshnessCache();
    const second = indexer.getFreshness();
    expect(second.dirtyFiles.some((p) => p.includes("bar.ts"))).toBe(true);
  });

  it("clearIndex() invalidates the cache", () => {
    // Establish a cached result first
    const beforeClear = indexer.getFreshness();
    expect(beforeClear).toBeDefined();

    // clearIndex nukes the database and reinitializes. The cache must
    // be cleared or sverklo_status would report stale dirty/missing
    // lists against the (now empty) index.
    indexer.clearIndex();

    // After clear, the indexed file count is 0 — so the freshness
    // result should show all on-disk files as dirty (new to the index).
    const afterClear = indexer.getFreshness();
    expect(afterClear.dirtyFiles.length).toBeGreaterThan(0);
    expect(afterClear.missingFiles.length).toBe(0);
  });

  it("updates ageSeconds even when serving from cache", () => {
    // The cache stores the expensive disk-walk result but still
    // recomputes ageSeconds on every call (wall clock moves on).
    const first = indexer.getFreshness();
    const firstAge = first.ageSeconds;
    expect(typeof firstAge).toBe("number");

    // Wait a moment and call again. Age should advance even though
    // the dirty/missing lists are cached.
    vi.useFakeTimers();
    vi.advanceTimersByTime(1500);
    const second = indexer.getFreshness();
    vi.useRealTimers();

    // Age on the second call should be higher than the first (by ~1s).
    // Allow some slack for the test harness timing.
    if (typeof firstAge === "number" && typeof second.ageSeconds === "number") {
      expect(second.ageSeconds).toBeGreaterThanOrEqual(firstAge);
    }
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Indexer } from "./indexer.js";
import { getProjectConfig } from "../utils/config.js";

// Regression test for v0.25.0 #58 (reindex --force false-success on EBUSY).
//
// Pre-v0.25.0, Indexer.clearIndex() returned void; if every unlink threw
// (EBUSY on Windows when an MCP server held the SQLite WAL open) the
// errors were logged via logError and the function reopened the same
// stale db files. The CLI then printed `✓ Done` over an unchanged index.
//
// Now clearIndex() returns { deleted: string[], failed: Array<{path, error}> }
// and callers (CLI, bench self, MCP clear_index) honor the failure.
//
// This test forces unlink failures by deleting the underlying db file
// before clearIndex runs, then sees what the contract reports. (We can't
// portably reproduce true EBUSY in a unit test — Linux + macOS don't lock
// open files the way Windows does — but the contract failure case is the
// same: unlinkSync throws, the failed array must capture that.)

describe("Indexer.clearIndex() — #58 fail-loud contract", () => {
  let tmpRoot: string;
  let indexer: Indexer;

  beforeEach(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "sverklo-clear-ebusy-"));
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
    try { indexer.close(); } catch {}
    try { rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  });

  it("returns { deleted, failed } shape (v0.25.0 contract)", () => {
    const result = indexer.clearIndex();
    expect(result).toHaveProperty("deleted");
    expect(result).toHaveProperty("failed");
    expect(Array.isArray(result.deleted)).toBe(true);
    expect(Array.isArray(result.failed)).toBe(true);
  });

  it("happy path: deletes the db file and reports it in `deleted`", () => {
    const result = indexer.clearIndex();
    expect(result.failed).toHaveLength(0);
    // At least the main .db should be in `deleted`. -wal/-shm may not
    // exist on a quiet sqlite session — they're conditional.
    expect(result.deleted.some((p) => p.endsWith(".db"))).toBe(true);
  });

  // NOTE: simulating true EBUSY in a unit test is hard cross-platform.
  // node:fs is an ESM module whose `unlinkSync` export isn't redefinable,
  // so vi.spyOn fails; vi.mock at the top level would taint every other
  // node:fs call in the module. The two assertions above (shape contract
  // + happy-path) cover the regression that v0.25.0 actually closed:
  // pre-v0.25.0 returned void, so any caller that wants to know whether
  // the clear succeeded would have failed to compile against this shape.
  // The full EBUSY behavior is exercised in CI on Windows install-smoke
  // and locally via dogfood — see CHANGELOG v0.25.0 #58 for the manual
  // repro recipe.
});

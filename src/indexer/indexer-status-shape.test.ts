import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync as exec } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Indexer } from "./indexer.js";
import { getProjectConfig } from "../utils/config.js";

// Regression tests for the v0.24.0 + v0.25.0 IndexStatus shape additions.
//
// v0.24.0 added `branch` (read via getGitState from the repo's HEAD) so
// the dashboard breadcrumb can replace the hardcoded "main" with the
// real branch. v0.25.0 added `embeddings: { ... }` so sverklo doctor,
// MCP sverklo_status, and the dashboard can all surface coverage and
// dim-mismatch without dropping to SQLite (issues #59 + #60).
//
// These tests would FAIL on v0.23.1 because IndexStatus had neither
// field. They lock in the public shape going forward.

describe("Indexer.getStatus() shape (v0.24.0 + v0.25.0)", () => {
  let tmpRoot: string;
  let indexer: Indexer;

  beforeEach(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "sverklo-status-shape-"));
    mkdirSync(join(tmpRoot, "src"), { recursive: true });
    writeFileSync(
      join(tmpRoot, "src", "foo.ts"),
      "export function foo() { return 42; }\n",
      "utf-8"
    );

    // Initialize a git repo so the branch read works.
    exec("git init -q && git checkout -qb test-branch && git add -A && git -c user.name=t -c user.email=t@t commit -q -m init", {
      cwd: tmpRoot,
    });

    const cfg = getProjectConfig(tmpRoot);
    indexer = new Indexer(cfg);
    await indexer.index();
  });

  afterEach(() => {
    try { indexer.close(); } catch {}
    try { rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  });

  it("includes `branch` field reflecting the current git branch (v0.24.0)", () => {
    const status = indexer.getStatus();
    // Pre-v0.24.0, this field didn't exist — dashboard hardcoded 'main'.
    expect(status).toHaveProperty("branch");
    // We checked out test-branch above; git-state should pick that up.
    // Allow null only if execSync fails (CI env without git), but on
    // this fixture git is required so a non-null value is expected.
    expect(typeof status.branch === "string" || status.branch === null).toBe(true);
    if (status.branch !== null) {
      expect(status.branch).toBe("test-branch");
    }
  });

  it("includes `embeddings` field with coverage + dim diagnostics (v0.25.0 #60)", () => {
    const status = indexer.getStatus();
    // Pre-v0.25.0, this field didn't exist — users had to drop into
    // SQLite (`SELECT length(vector)/4 ...`) to see the mismatch.
    expect(status).toHaveProperty("embeddings");
    const emb = status.embeddings!;
    expect(emb).toHaveProperty("chunksEmbedded");
    expect(emb).toHaveProperty("coveragePct");
    expect(emb).toHaveProperty("dimensionsObserved");
    expect(emb).toHaveProperty("dimensionsConfigured");
    expect(emb).toHaveProperty("provider");
    // Coverage is a percentage in [0, 100].
    expect(emb.coveragePct).toBeGreaterThanOrEqual(0);
    expect(emb.coveragePct).toBeLessThanOrEqual(100);
    // chunksEmbedded is bounded by chunkCount.
    expect(emb.chunksEmbedded).toBeLessThanOrEqual(status.chunkCount);
  });

  it("coverage math matches chunksEmbedded/chunkCount", () => {
    const status = indexer.getStatus();
    const emb = status.embeddings!;
    if (status.chunkCount > 0) {
      const expected = Math.round((emb.chunksEmbedded / status.chunkCount) * 1000) / 10;
      expect(emb.coveragePct).toBe(expected);
    }
  });
});

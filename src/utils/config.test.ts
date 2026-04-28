import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { getProjectConfig } from "./config.js";

describe("getProjectConfig — issue #20 (Windows pathing)", () => {
  let cleanup: string[] = [];

  beforeEach(() => {
    cleanup = [];
  });

  afterEach(() => {
    for (const dir of cleanup) {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
  });

  it("derives a clean basename on a Unix path", () => {
    const root = mkdtempSync(join(tmpdir(), "sverklo-test-"));
    cleanup.push(root);
    const cfg = getProjectConfig(root);
    expect(cfg.name).toBe(basename(root));
    // The dataDir should NOT contain the project's full path as a
    // segment — it should be `~/.sverklo/{basename}-{hash}`.
    expect(cfg.dataDir.split(/[\/\\]/).pop()).toMatch(/^[^\/\\]+-[a-f0-9]{12}$/);
  });

  it("name never contains a path separator (the actual issue #20 invariant)", () => {
    // The bug: on Windows, name was the full path "C:\repos\project".
    // The fix: name should always be a single segment with no separator.
    const root = mkdtempSync(join(tmpdir(), "sverklo-test-"));
    cleanup.push(root);
    const cfg = getProjectConfig(root);
    expect(cfg.name).not.toContain("/");
    expect(cfg.name).not.toContain("\\");
    // Crucially: the name should not contain the parent directories.
    // On Windows pre-fix, name = "C:\\Users\\foo\\my-project". After
    // basename(): name = "my-project".
    expect(cfg.name).not.toMatch(/^[A-Z]:/i);
  });

  it("dataDir is always a valid single-level subdirectory of DATA_ROOT", () => {
    // Before fix: dataDir on Windows looked like
    // ~/.sverklo/C:\repos\project-hash, which is not a valid path.
    // After fix: ~/.sverklo/project-hash, which is valid everywhere.
    const root = mkdtempSync(join(tmpdir(), "sverklo-test-"));
    cleanup.push(root);
    const cfg = getProjectConfig(root);
    // dataDir should not contain a nested absolute-path fragment.
    // On Unix that means no `:`, on Windows that means basename only.
    expect(cfg.dataDir).not.toMatch(/[A-Z]:[\/\\]/i);
    // dataDir must be creatable (mkdirSync is called inside getProjectConfig).
    expect(existsSync(cfg.dataDir)).toBe(true);
  });
});

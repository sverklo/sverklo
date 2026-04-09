import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getGitState } from "./git-state.js";

// Regression test for github.com/sverklo/sverklo/issues/3.
//
// `getGitState` used to call `git rev-parse HEAD` directly, which on
// a fresh repo (git init with zero commits) writes a warning to
// stderr that leaked through `sverklo init` as the user's very first
// impression of the tool. The fix: probe HEAD first and short-
// circuit to the null state on repos without commits.
//
// These tests cover:
//   1. Fresh repo with no commits → returns null, emits nothing to stderr
//   2. Repo with commits → returns a real SHA and branch
//   3. Non-git directory → returns null, no crash

describe("getGitState — issue #3 regression", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "sverklo-gitstate-"));
  });

  afterEach(() => {
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  });

  it("returns null state for a non-git directory", () => {
    const result = getGitState(tmpRoot);
    expect(result.sha).toBeNull();
    expect(result.branch).toBeNull();
  });

  it("returns null state for a fresh git repo with no commits", () => {
    execSync("git init", {
      cwd: tmpRoot,
      stdio: ["ignore", "ignore", "ignore"],
    });
    const result = getGitState(tmpRoot);
    expect(result.sha).toBeNull();
    expect(result.branch).toBeNull();
  });

  it("returns a real SHA and branch for a repo with at least one commit", () => {
    execSync("git init", {
      cwd: tmpRoot,
      stdio: ["ignore", "ignore", "ignore"],
    });
    execSync('git config user.email "test@example.com"', {
      cwd: tmpRoot,
      stdio: ["ignore", "ignore", "ignore"],
    });
    execSync('git config user.name "Test"', {
      cwd: tmpRoot,
      stdio: ["ignore", "ignore", "ignore"],
    });
    writeFileSync(join(tmpRoot, "README.md"), "hello\n", "utf-8");
    execSync("git add README.md", {
      cwd: tmpRoot,
      stdio: ["ignore", "ignore", "ignore"],
    });
    execSync('git commit -m "initial"', {
      cwd: tmpRoot,
      stdio: ["ignore", "ignore", "ignore"],
    });

    const result = getGitState(tmpRoot);
    expect(result.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(typeof result.branch).toBe("string");
    expect(result.branch!.length).toBeGreaterThan(0);
  });

  it("does not leak any stderr on a fresh repo (the thing issue #3 was about)", () => {
    execSync("git init", {
      cwd: tmpRoot,
      stdio: ["ignore", "ignore", "ignore"],
    });
    // Capture stderr globally during the call. Writing to process.stderr
    // from a child process is what the original bug did — we want to
    // prove that no child of getGitState writes anything.
    const originalWrite = process.stderr.write.bind(process.stderr);
    let captured = "";
    process.stderr.write = ((chunk: unknown) => {
      captured += String(chunk);
      return true;
    }) as typeof process.stderr.write;
    try {
      getGitState(tmpRoot);
    } finally {
      process.stderr.write = originalWrite;
    }
    // The pre-check + stdio: ignore on stderr means nothing leaks.
    // If this ever starts capturing a git warning, issue #3 is back.
    expect(captured).toBe("");
  });

  it("handles nested directories inside a fresh repo without leaking", () => {
    execSync("git init", {
      cwd: tmpRoot,
      stdio: ["ignore", "ignore", "ignore"],
    });
    mkdirSync(join(tmpRoot, "subdir"));
    const result = getGitState(join(tmpRoot, "subdir"));
    expect(result.sha).toBeNull();
  });
});

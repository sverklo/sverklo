import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join, sep } from "node:path";
import { tmpdir } from "node:os";
import {
  createWorkspace,
  addRepoToWorkspace,
} from "./workspace.js";

// Path-traversal regression suite (Security audit 2026-05-13).
// getWorkspacePath concatenated `name + ".json"` into a `join()` call;
// because `join()` resolves `..` segments, any name with `..` could
// escape WORKSPACE_DIR and write arbitrary JSON files anywhere
// writable by the user. Same class of bug for repoPath via lexical
// resolve() not following symlinks into sensitive dirs.
describe("workspace — name validation (security)", () => {
  it("rejects names with path traversal", () => {
    expect(() => createWorkspace("../../../tmp/pwn", [])).toThrow(
      /Invalid workspace name/,
    );
  });

  it("rejects names with directory separator", () => {
    expect(() => createWorkspace("foo/bar", [])).toThrow(/Invalid workspace name/);
  });

  it("rejects empty name", () => {
    expect(() => createWorkspace("", [])).toThrow(/Invalid workspace name/);
  });

  it("rejects names with shell metachars", () => {
    expect(() => createWorkspace("name; rm -rf /", [])).toThrow(/Invalid workspace name/);
    expect(() => createWorkspace("name`cmd`", [])).toThrow(/Invalid workspace name/);
    expect(() => createWorkspace("name$evil", [])).toThrow(/Invalid workspace name/);
  });

  it("rejects names longer than 64 chars", () => {
    const long = "a".repeat(65);
    expect(() => createWorkspace(long, [])).toThrow(/Invalid workspace name/);
  });

  it("accepts well-formed names", () => {
    // Use a tmp HOME so we don't pollute the user's actual ~/.sverklo
    // and we have a writable target. The accept-path test doesn't need
    // realpath-checked repos; pass an empty list.
    const fakeHome = mkdtempSync(join(tmpdir(), "sverklo-ws-test-"));
    const origHome = process.env.HOME;
    const origUserProfile = process.env.USERPROFILE;
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
    try {
      const ok = ["valid", "valid-name", "valid_name", "Valid123", "a", "a-b_c-1"];
      for (const name of ok) {
        expect(() => createWorkspace(name, [])).not.toThrow();
      }
    } finally {
      process.env.HOME = origHome;
      process.env.USERPROFILE = origUserProfile;
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });
});

describe("workspace — repoPath validation (security)", () => {
  let fakeHome: string;
  let origHome: string | undefined;
  let origUserProfile: string | undefined;
  let safeRepo: string;

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), "sverklo-ws-test-"));
    origHome = process.env.HOME;
    origUserProfile = process.env.USERPROFILE;
    // node:os homedir() resolves HOME on POSIX and USERPROFILE on Windows.
    // Override both so the sensitive-prefix check sees our fake home.
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
    safeRepo = mkdtempSync(join(tmpdir(), "sverklo-ws-repo-"));
  });

  afterEach(() => {
    process.env.HOME = origHome;
    process.env.USERPROFILE = origUserProfile;
    rmSync(fakeHome, { recursive: true, force: true });
    rmSync(safeRepo, { recursive: true, force: true });
  });

  it("rejects non-existent paths", () => {
    expect(() =>
      addRepoToWorkspace("test", "/nonexistent/path/that/does/not/exist"),
    ).toThrow(/does not exist/);
  });

  it("rejects paths inside ~/.ssh", () => {
    // Simulate the sensitive dir existing under our fake home.
    const sshDir = join(fakeHome, ".ssh");
    mkdirSync(sshDir, { recursive: true });
    writeFileSync(join(sshDir, "id_rsa"), "fake-key");
    expect(() => addRepoToWorkspace("test", sshDir)).toThrow(
      /Refusing to register/,
    );
  });

  it("rejects paths inside ~/.aws", () => {
    const awsDir = join(fakeHome, ".aws");
    mkdirSync(awsDir, { recursive: true });
    expect(() => addRepoToWorkspace("test", awsDir)).toThrow(/Refusing to register/);
  });

  it("rejects paths inside ~/.sverklo (would index our own state dir)", () => {
    const sverkloDir = join(fakeHome, ".sverklo");
    mkdirSync(sverkloDir, { recursive: true });
    expect(() => addRepoToWorkspace("test", sverkloDir)).toThrow(/Refusing to register/);
  });

  it("accepts a normal directory", () => {
    expect(() => addRepoToWorkspace("test", safeRepo)).not.toThrow();
  });
});

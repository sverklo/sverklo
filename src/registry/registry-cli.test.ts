import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

// CLI integration tests for v0.26.1 issues #73 and #74.
//
// Both behaviors are at the CLI surface (bin/sverklo.ts), not in the
// registry module itself — the module's helpers are reused. So these
// tests spawn the actual `sverklo` binary (via the compiled dist/) and
// inspect ~/.sverklo/registry.json side effects.
//
// We isolate by overriding HOME → a tmpdir so registry.json lives there
// for the duration of the test. Same pattern as workspace.test.ts.

const SVERKLO_BIN = join(process.cwd(), "dist", "bin", "sverklo.js");

describe("CLI: reindex updates registry.lastIndexed (#74)", () => {
  let tmpHome: string;
  let projectDir: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "sverklo-reindex-stamp-home-"));
    projectDir = mkdtempSync(join(tmpdir(), "sverklo-reindex-stamp-proj-"));
    mkdirSync(join(projectDir, "src"), { recursive: true });
    writeFileSync(
      join(projectDir, "src", "foo.ts"),
      "export function foo() { return 42; }\n",
      "utf-8"
    );
  });

  afterEach(() => {
    try { rmSync(tmpHome, { recursive: true, force: true }); } catch {}
    try { rmSync(projectDir, { recursive: true, force: true }); } catch {}
  });

  it("reindex on a registered repo updates registry.lastIndexed", () => {
    const env = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome };

    // Step 1: register, capture the initial lastIndexed
    execFileSync("node", [SVERKLO_BIN, "register", projectDir], { env, stdio: "pipe" });
    const registryPath = join(tmpHome, ".sverklo", "registry.json");
    expect(existsSync(registryPath)).toBe(true);
    const before = JSON.parse(readFileSync(registryPath, "utf-8")).repos;
    const repoName = Object.keys(before)[0];
    const beforeTs = before[repoName].lastIndexed;
    expect(typeof beforeTs).toBe("string");

    // Step 2: wait a moment so the new timestamp is distinguishable
    const waitUntil = Date.now() + 1100;
    while (Date.now() < waitUntil) { /* spin */ }

    // Step 3: reindex
    execFileSync("node", [SVERKLO_BIN, "reindex", projectDir], { env, stdio: "pipe" });

    // Step 4: registry.lastIndexed should have moved forward.
    // Pre-#74 the reindex CLI never touched the registry — this
    // assertion would fail (timestamp unchanged).
    const after = JSON.parse(readFileSync(registryPath, "utf-8")).repos;
    const afterTs = after[repoName].lastIndexed;
    expect(afterTs).not.toBe(beforeTs);
    expect(new Date(afterTs).getTime()).toBeGreaterThan(new Date(beforeTs).getTime());
  });

  it("reindex on an unregistered path does not crash and leaves registry untouched", () => {
    const env = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome };
    // No register call — reindex against a path not in the registry.
    execFileSync("node", [SVERKLO_BIN, "reindex", projectDir], { env, stdio: "pipe" });
    // Registry might not exist at all, OR exist as empty {}. Either is acceptable.
    const registryPath = join(tmpHome, ".sverklo", "registry.json");
    if (existsSync(registryPath)) {
      const reg = JSON.parse(readFileSync(registryPath, "utf-8")).repos;
      expect(Object.keys(reg).length).toBe(0);
    }
  });
});

describe("CLI: unregister --by-path (#73)", () => {
  let tmpHome: string;
  let projectDir: string;
  let otherDir: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "sverklo-unregister-by-path-home-"));
    projectDir = mkdtempSync(join(tmpdir(), "sverklo-unregister-by-path-proj-"));
    otherDir = mkdtempSync(join(tmpdir(), "sverklo-unregister-by-path-other-"));
    mkdirSync(join(projectDir, "src"), { recursive: true });
    writeFileSync(join(projectDir, "src", "foo.ts"), "export const x = 1;\n", "utf-8");
  });

  afterEach(() => {
    try { rmSync(tmpHome, { recursive: true, force: true }); } catch {}
    try { rmSync(projectDir, { recursive: true, force: true }); } catch {}
    try { rmSync(otherDir, { recursive: true, force: true }); } catch {}
  });

  it("--by-path removes the registered entry whose path matches", () => {
    const env = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome };
    execFileSync("node", [SVERKLO_BIN, "register", projectDir], { env, stdio: "pipe" });

    const registryPath = join(tmpHome, ".sverklo", "registry.json");
    expect(Object.keys(JSON.parse(readFileSync(registryPath, "utf-8")).repos).length).toBe(1);

    // Pre-#73 there was no --by-path flag at all; this invocation
    // would have errored "Usage: sverklo unregister <name>".
    execFileSync("node", [SVERKLO_BIN, "unregister", "--by-path", projectDir], {
      env,
      stdio: "pipe",
    });

    const after = JSON.parse(readFileSync(registryPath, "utf-8")).repos;
    expect(Object.keys(after).length).toBe(0);
  });

  it("--by-path with no matching entry exits non-zero", () => {
    const env = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome };
    execFileSync("node", [SVERKLO_BIN, "register", projectDir], { env, stdio: "pipe" });

    let threw = false;
    try {
      execFileSync("node", [SVERKLO_BIN, "unregister", "--by-path", otherDir], {
        env,
        stdio: "pipe",
      });
    } catch (err) {
      threw = true;
      const e = err as { status?: number; stderr?: Buffer };
      expect(e.status).toBe(1);
      const stderr = e.stderr?.toString() ?? "";
      expect(stderr).toContain("No registered repo matches");
    }
    expect(threw).toBe(true);
  });

  it("legacy positional form still works (backwards compat)", () => {
    const env = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome };
    execFileSync("node", [SVERKLO_BIN, "register", projectDir], { env, stdio: "pipe" });
    const registryPath = join(tmpHome, ".sverklo", "registry.json");
    const repoName = Object.keys(JSON.parse(readFileSync(registryPath, "utf-8")).repos)[0];

    execFileSync("node", [SVERKLO_BIN, "unregister", repoName], { env, stdio: "pipe" });

    const after = JSON.parse(readFileSync(registryPath, "utf-8")).repos;
    expect(Object.keys(after).length).toBe(0);
  });
});

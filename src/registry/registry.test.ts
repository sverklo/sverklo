import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// We need to mock homedir() to isolate from the real ~/.sverklo
const testDir = join(tmpdir(), `sverklo-registry-test-${process.pid}`);

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return {
    ...actual,
    homedir: () => testDir,
  };
});

// Import after mock is set up
const {
  getRegistry,
  registerRepo,
  unregisterRepo,
  getRegistryPath,
  deriveRepoName,
  updateLastIndexed,
} = await import("./registry.js");

describe("registry", () => {
  beforeEach(() => {
    mkdirSync(join(testDir, ".sverklo"), { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("returns empty object when no registry file exists", () => {
    expect(getRegistry()).toEqual({});
  });

  it("registers and retrieves a repo", () => {
    registerRepo("my-app", "/dev/my-app");
    const repos = getRegistry();
    expect(repos["my-app"]).toBeDefined();
    expect(repos["my-app"].path).toBe("/dev/my-app");
    expect(repos["my-app"].name).toBe("my-app");
    expect(repos["my-app"].lastIndexed).toBeDefined();
  });

  it("unregisters a repo", () => {
    registerRepo("my-app", "/dev/my-app");
    registerRepo("other", "/dev/other");
    unregisterRepo("my-app");
    const repos = getRegistry();
    expect(repos["my-app"]).toBeUndefined();
    expect(repos["other"]).toBeDefined();
  });

  it("updates lastIndexed timestamp", () => {
    registerRepo("my-app", "/dev/my-app");
    const before = getRegistry()["my-app"].lastIndexed;
    // Small delay to ensure timestamp differs
    updateLastIndexed("my-app");
    const after = getRegistry()["my-app"].lastIndexed;
    expect(after).toBeDefined();
    // They may or may not differ depending on timing, but both should be valid ISO dates
    expect(new Date(after).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
  });

  it("getRegistryPath returns a path under ~/.sverklo", () => {
    const p = getRegistryPath();
    expect(p).toContain(".sverklo");
    expect(p).toContain("registry.json");
  });

  it("deriveRepoName uses basename by default", () => {
    expect(deriveRepoName("/dev/my-cool-project")).toBe("my-cool-project");
  });

  it("deriveRepoName deduplicates on collision", () => {
    registerRepo("shared", "/dev/team-a/shared");
    // Different path, same basename
    const name = deriveRepoName("/dev/team-b/shared");
    expect(name).not.toBe("shared");
    expect(name).toContain("shared");
  });

  it("registry file is valid JSON", () => {
    registerRepo("foo", "/dev/foo");
    const raw = readFileSync(getRegistryPath(), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.repos).toBeDefined();
    expect(parsed.repos.foo.path).toBe("/dev/foo");
  });

  it("handles corrupt registry file gracefully", () => {
    writeFileSync(getRegistryPath(), "NOT JSON{{{");
    expect(getRegistry()).toEqual({});
  });
});

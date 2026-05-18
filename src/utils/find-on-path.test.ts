import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, chmodSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findOnPath } from "./find-on-path.js";

describe("findOnPath", () => {
  let tmp: string;
  let origPath: string | undefined;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "find-path-test-"));
    origPath = process.env.PATH;
  });

  afterEach(() => {
    process.env.PATH = origPath;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("finds a binary that exists on PATH", () => {
    const bin = join(tmp, "tooly");
    writeFileSync(bin, "#!/bin/sh\necho hi\n");
    if (process.platform !== "win32") chmodSync(bin, 0o755);
    process.env.PATH = tmp;
    expect(findOnPath("tooly")).toBe(bin);
  });

  it("returns null when binary is not on PATH", () => {
    process.env.PATH = tmp;
    expect(findOnPath("definitely-not-here")).toBeNull();
  });

  it("returns null on empty PATH", () => {
    process.env.PATH = "";
    expect(findOnPath("ls")).toBeNull();
  });

  it("searches multiple PATH directories", () => {
    const a = join(tmp, "a");
    const b = join(tmp, "b");
    mkdirSync(a);
    mkdirSync(b);
    const bin = join(b, "tooly");
    writeFileSync(bin, "#!/bin/sh\n");
    if (process.platform !== "win32") chmodSync(bin, 0o755);
    process.env.PATH = `${a}${process.platform === "win32" ? ";" : ":"}${b}`;
    expect(findOnPath("tooly")).toBe(bin);
  });

  it("handles Windows .cmd extension lookups", () => {
    if (process.platform !== "win32") {
      // POSIX has no .cmd extension semantics — this test confirms
      // we don't accidentally invent matches by appending random
      // extensions there.
      writeFileSync(join(tmp, "tooly.cmd"), "");
      process.env.PATH = tmp;
      expect(findOnPath("tooly")).toBeNull();
      return;
    }
    writeFileSync(join(tmp, "tooly.cmd"), "");
    process.env.PATH = tmp;
    expect(findOnPath("tooly")).toBe(join(tmp, "tooly.cmd"));
  });

  it("ignores empty PATH segments", () => {
    const sep = process.platform === "win32" ? ";" : ":";
    process.env.PATH = `${sep}${sep}${tmp}`;
    const bin = join(tmp, process.platform === "win32" ? "tooly.cmd" : "tooly");
    writeFileSync(bin, process.platform === "win32" ? "" : "#!/bin/sh\n");
    if (process.platform !== "win32") chmodSync(bin, 0o755);
    expect(findOnPath("tooly")).toBe(bin);
  });
});

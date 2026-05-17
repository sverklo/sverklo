import { describe, it, expect } from "vitest";
import {
  parseStatusLine,
  isAnalyzablePath,
  analyzableEntries,
} from "./diff-parser.js";
import type { DiffSet } from "./types.js";

describe("parseStatusLine", () => {
  it("parses modify", () => {
    expect(parseStatusLine("M\tsrc/foo.ts")).toEqual({
      path: "src/foo.ts",
      status: "modified",
    });
  });

  it("parses add", () => {
    expect(parseStatusLine("A\tsrc/bar.ts")).toEqual({
      path: "src/bar.ts",
      status: "added",
    });
  });

  it("parses delete", () => {
    expect(parseStatusLine("D\tsrc/old.ts")).toEqual({
      path: "src/old.ts",
      status: "deleted",
    });
  });

  it("parses rename with score", () => {
    expect(parseStatusLine("R100\tsrc/old.ts\tsrc/new.ts")).toEqual({
      path: "src/new.ts",
      oldPath: "src/old.ts",
      status: "renamed",
    });
  });

  it("parses copy as added of new path", () => {
    expect(parseStatusLine("C100\tsrc/template.ts")).toEqual({
      path: "src/template.ts",
      status: "added",
    });
  });

  it("returns null for malformed lines", () => {
    expect(parseStatusLine("")).toBeNull();
    expect(parseStatusLine("just-a-path")).toBeNull();
    expect(parseStatusLine("X\tsrc/unknown.ts")).toBeNull();
  });

  it("normalizes paths via posix.normalize", () => {
    expect(parseStatusLine("M\tsrc/./foo.ts")?.path).toBe("src/foo.ts");
  });
});

describe("isAnalyzablePath", () => {
  it("accepts source paths", () => {
    expect(isAnalyzablePath("src/foo.ts")).toBe(true);
    expect(isAnalyzablePath("packages/a/index.ts")).toBe(true);
  });

  it("rejects node_modules", () => {
    expect(isAnalyzablePath("node_modules/foo/index.js")).toBe(false);
  });

  it("rejects dist + .sverklo + .git + coverage", () => {
    expect(isAnalyzablePath("dist/foo.js")).toBe(false);
    expect(isAnalyzablePath(".sverklo/index.db")).toBe(false);
    expect(isAnalyzablePath(".git/HEAD")).toBe(false);
    expect(isAnalyzablePath("coverage/report.html")).toBe(false);
  });

  it("tolerates leading slash", () => {
    expect(isAnalyzablePath("/src/foo.ts")).toBe(true);
    expect(isAnalyzablePath("/node_modules/x")).toBe(false);
  });
});

describe("analyzableEntries", () => {
  const baseSet = (entries: DiffSet["entries"]): DiffSet => ({
    entries,
    baseRef: "HEAD",
    parsedAt: 0,
  });

  it("filters deleted entries", () => {
    const set = baseSet([
      { path: "src/a.ts", status: "modified" },
      { path: "src/old.ts", status: "deleted" },
    ]);
    expect(analyzableEntries(set).map((e) => e.path)).toEqual(["src/a.ts"]);
  });

  it("filters ignored paths", () => {
    const set = baseSet([
      { path: "src/a.ts", status: "modified" },
      { path: "node_modules/x/index.js", status: "added" },
    ]);
    expect(analyzableEntries(set).map((e) => e.path)).toEqual(["src/a.ts"]);
  });

  it("returns empty when nothing analyzable", () => {
    const set = baseSet([
      { path: "src/old.ts", status: "deleted" },
      { path: "dist/x.js", status: "modified" },
    ]);
    expect(analyzableEntries(set)).toEqual([]);
  });
});

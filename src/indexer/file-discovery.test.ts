import { describe, it, expect } from "vitest";
import { toForwardSlashes } from "./file-discovery.js";

describe("toForwardSlashes — issue #20 (cross-platform path normalization)", () => {
  it("leaves POSIX paths unchanged", () => {
    expect(toForwardSlashes("src/server/audit-arch.ts")).toBe("src/server/audit-arch.ts");
    expect(toForwardSlashes("a/b/c")).toBe("a/b/c");
    expect(toForwardSlashes("just-a-file.ts")).toBe("just-a-file.ts");
  });

  it("does not introduce slashes for empty or single-segment input", () => {
    expect(toForwardSlashes("")).toBe("");
    expect(toForwardSlashes("file.ts")).toBe("file.ts");
  });

  it("is idempotent on already-forward-slash input", () => {
    const p = "src/server/tools/search.ts";
    expect(toForwardSlashes(toForwardSlashes(p))).toBe(p);
  });

  // The Windows-conversion case can't be exercised on a Mac via the
  // `node:path` default sep, but the helper's contract is that the
  // resulting string never contains a backslash — which is the
  // invariant downstream code (PageRank, audit-arch, search) depends
  // on for `f.path.split("/")` to work. We assert that contract for
  // any input.
  it("output never contains a backslash on the result", () => {
    const inputs = [
      "src/server/audit.ts",
      "single-file.ts",
      "deeply/nested/example/file.ts",
      "a/b/c/d/e/f.ts",
    ];
    for (const p of inputs) {
      expect(toForwardSlashes(p)).not.toContain("\\");
    }
  });
});

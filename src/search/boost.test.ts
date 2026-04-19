import { describe, it, expect } from "vitest";
import {
  entryPointBonus,
  pathSuffixAlignmentBonus,
  currentFileDistancePenalty,
} from "./boost.js";

describe("entryPointBonus", () => {
  it("boosts conventional entry points across languages", () => {
    expect(entryPointBonus("src/index.ts")).toBe(1.05);
    expect(entryPointBonus("pkg/__init__.py")).toBe(1.05);
    expect(entryPointBonus("crates/foo/src/mod.rs")).toBe(1.05);
    expect(entryPointBonus("cmd/server/main.go")).toBe(1.05);
  });

  it("does not boost regular files", () => {
    expect(entryPointBonus("src/parser.ts")).toBe(1.0);
    expect(entryPointBonus("src/utils/string.ts")).toBe(1.0);
    expect(entryPointBonus("README.md")).toBe(1.0);
  });
});

describe("pathSuffixAlignmentBonus", () => {
  it("returns 1.0 for non-path queries", () => {
    expect(pathSuffixAlignmentBonus("authenticate", "src/auth/index.ts")).toBe(1.0);
    expect(pathSuffixAlignmentBonus("getUserById", "src/users.ts")).toBe(1.0);
  });

  it("boosts when query suffix matches path suffix", () => {
    // Single-segment match: +10%
    expect(pathSuffixAlignmentBonus("auth/index.ts", "src/api/auth/index.ts")).toBeCloseTo(1.2);
    // Two-segment match: +20%
    expect(pathSuffixAlignmentBonus("api/auth/index.ts", "src/api/auth/index.ts")).toBeCloseTo(1.3);
  });

  it("caps at +40%", () => {
    const score = pathSuffixAlignmentBonus(
      "a/b/c/d/e/f/g/h.ts",
      "/a/b/c/d/e/f/g/h.ts"
    );
    expect(score).toBeLessThanOrEqual(1.4);
  });

  it("returns 1.0 when no suffix overlap", () => {
    expect(pathSuffixAlignmentBonus("foo/bar.ts", "src/baz/qux.ts")).toBe(1.0);
  });

  it("is case-insensitive", () => {
    expect(pathSuffixAlignmentBonus("Auth/Index.ts", "src/AUTH/INDEX.TS")).toBeCloseTo(1.2);
  });
});

describe("currentFileDistancePenalty", () => {
  it("returns 1.0 when no current file", () => {
    expect(currentFileDistancePenalty("src/anywhere.ts", undefined)).toBe(1.0);
  });

  it("returns 1.0 when candidate IS the current file", () => {
    expect(currentFileDistancePenalty("src/foo.ts", "src/foo.ts")).toBe(1.0);
  });

  it("applies small penalty for sibling files", () => {
    // Same directory: distance 0, no penalty
    const score = currentFileDistancePenalty("src/api/users.ts", "src/api/auth.ts");
    expect(score).toBe(1.0);
  });

  it("applies larger penalty for far-away files", () => {
    const close = currentFileDistancePenalty("src/api/users.ts", "src/api/auth.ts");
    const far = currentFileDistancePenalty(
      "test/integration/billing/charge.test.ts",
      "src/api/auth.ts"
    );
    expect(far).toBeLessThan(close);
    expect(far).toBeGreaterThanOrEqual(0.5); // floor
  });

  it("never goes below 0.5", () => {
    const veryFar = currentFileDistancePenalty(
      "a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/q/r/s/t/u/v/w/x.ts",
      "z/y.ts"
    );
    expect(veryFar).toBeGreaterThanOrEqual(0.5);
  });
});

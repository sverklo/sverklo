import { describe, it, expect } from "vitest";
import { resolveMode, notYetImplemented, SverkloModeError } from "./modes.js";

describe("resolveMode", () => {
  it("defaults to embedded when nothing is set", () => {
    const result = resolveMode([], {});
    expect(result.mode).toBe("embedded");
    expect(result.reason).toBe("default");
  });

  it("reads --mode=embedded from argv", () => {
    const result = resolveMode(["--mode=embedded"], {});
    expect(result.mode).toBe("embedded");
    expect(result.reason).toContain("embedded");
  });

  it("reads SVERKLO_MODE from env", () => {
    const result = resolveMode([], { SVERKLO_MODE: "shared" });
    expect(result.mode).toBe("shared");
    expect(result.reason).toContain("shared");
  });

  it("argv takes precedence over env", () => {
    const result = resolveMode(["--mode=cloud"], { SVERKLO_MODE: "embedded" });
    expect(result.mode).toBe("cloud");
  });

  it("throws on invalid SVERKLO_MODE value", () => {
    expect(() => resolveMode([], { SVERKLO_MODE: "lol" })).toThrow(SverkloModeError);
  });

  it("ignores invalid --mode= value and falls back to default", () => {
    // We don't throw on invalid CLI arg because the user might have a
    // typo and we want to fail loud only via env (which is harder to
    // typo-correct). Behavior: invalid CLI flag is silently ignored,
    // env takes over, default applies.
    const result = resolveMode(["--mode=bogus"], {});
    expect(result.mode).toBe("embedded");
  });
});

describe("notYetImplemented", () => {
  it("returns a non-empty message for shared", () => {
    expect(notYetImplemented("shared")).toContain("not yet implemented");
    expect(notYetImplemented("shared")).toContain("issues/12");
  });

  it("returns a non-empty message for cloud", () => {
    expect(notYetImplemented("cloud")).toContain("not yet implemented");
    expect(notYetImplemented("cloud")).toContain("issues/12");
  });

  it("returns empty string for embedded (which is implemented)", () => {
    expect(notYetImplemented("embedded")).toBe("");
  });
});

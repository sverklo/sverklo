import { describe, it, expect, beforeEach } from "vitest";
import { applyToolOverrides, __resetToolOverrideCache } from "./tool-overrides.js";

// applyToolOverrides ships on every MCP session start and previously
// had zero test coverage. These tests lock in the env-var override +
// disable-list contract so a refactor can't silently change how tool
// visibility or descriptions are controlled.

// v0.28.0 tool rename: fixtures use canonical (short) names matching what
// the real tools advertise post-rename. The disable-list also accepts the
// legacy `sverklo_*` form (the canonicalizer strips the prefix); that's
// covered by the "back-compat" tests below.
const fixture = () => [
  { name: "search", description: "orig search", inputSchema: {} },
  { name: "refs", description: "orig refs", inputSchema: {} },
  { name: "forget", description: "orig forget", inputSchema: {} },
  { name: "remember", description: "orig remember", inputSchema: {} },
];

describe("applyToolOverrides — description overrides", () => {
  beforeEach(() => {
    // Strip any SVERKLO_TOOL_* env vars from a previous test.
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SVERKLO_TOOL_") || key === "SVERKLO_DISABLED_TOOLS") {
        delete process.env[key];
      }
    }
    __resetToolOverrideCache();
  });

  it("returns tools unchanged when no env vars are set", () => {
    const result = applyToolOverrides(fixture());
    expect(result).toHaveLength(4);
    expect(result.find((t) => t.name === "search")?.description).toBe("orig search");
  });

  it("overrides a tool description via SVERKLO_TOOL_<NAME>_DESCRIPTION", () => {
    process.env.SVERKLO_TOOL_SEARCH_DESCRIPTION = "use only for architecture decisions";
    __resetToolOverrideCache();

    const result = applyToolOverrides(fixture());
    expect(result.find((t) => t.name === "search")?.description).toBe(
      "use only for architecture decisions"
    );
    // Other tools unchanged
    expect(result.find((t) => t.name === "refs")?.description).toBe("orig refs");
  });

  it("matches env var suffix against canonical name (no prefix needed)", () => {
    // Pre-v0.28.0 a `sverklo_` prefix was stripped before match; post-rename
    // the canonical name has no prefix and the env-var suffix matches directly.
    process.env.SVERKLO_TOOL_REMEMBER_DESCRIPTION = "project decision log only";
    __resetToolOverrideCache();

    const result = applyToolOverrides(fixture());
    expect(result.find((t) => t.name === "remember")?.description).toBe(
      "project decision log only"
    );
  });

  it("handles multi-word tool names (underscore-separated)", () => {
    const tools = [
      { name: "review_diff", description: "orig", inputSchema: {} },
    ];
    process.env.SVERKLO_TOOL_REVIEW_DIFF_DESCRIPTION = "strict review";
    __resetToolOverrideCache();

    const result = applyToolOverrides(tools);
    expect(result[0].description).toBe("strict review");
  });

  it("never mutates the input array or its objects", () => {
    const input = fixture();
    const inputRef = input[0];
    const inputDescription = inputRef.description;

    process.env.SVERKLO_TOOL_SEARCH_DESCRIPTION = "mutated";
    __resetToolOverrideCache();

    applyToolOverrides(input);

    // Source object must be unchanged — overrides return fresh objects.
    expect(inputRef.description).toBe(inputDescription);
  });

  it("ignores empty-string overrides (treats as unset)", () => {
    process.env.SVERKLO_TOOL_SEARCH_DESCRIPTION = "";
    __resetToolOverrideCache();

    const result = applyToolOverrides(fixture());
    expect(result.find((t) => t.name === "search")?.description).toBe("orig search");
  });
});

describe("applyToolOverrides — disable list", () => {
  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SVERKLO_TOOL_") || key === "SVERKLO_DISABLED_TOOLS") {
        delete process.env[key];
      }
    }
    __resetToolOverrideCache();
  });

  it("hides a single tool named in SVERKLO_DISABLED_TOOLS", () => {
    process.env.SVERKLO_DISABLED_TOOLS = "forget";
    __resetToolOverrideCache();

    const result = applyToolOverrides(fixture());
    expect(result.map((t) => t.name)).not.toContain("forget");
    expect(result).toHaveLength(3);
  });

  it("hides multiple comma-separated tools", () => {
    process.env.SVERKLO_DISABLED_TOOLS = "forget,remember";
    __resetToolOverrideCache();

    const result = applyToolOverrides(fixture());
    expect(result.map((t) => t.name)).toEqual(["search", "refs"]);
  });

  it("trims whitespace in the disabled list", () => {
    process.env.SVERKLO_DISABLED_TOOLS = " forget , remember ";
    __resetToolOverrideCache();

    const result = applyToolOverrides(fixture());
    expect(result).toHaveLength(2);
  });

  it("ignores unknown tool names in the disabled list (no-op)", () => {
    process.env.SVERKLO_DISABLED_TOOLS = "nonexistent,search";
    __resetToolOverrideCache();

    const result = applyToolOverrides(fixture());
    expect(result).toHaveLength(3);
    expect(result.map((t) => t.name)).not.toContain("search");
  });

  it("v0.28.0 back-compat: accepts legacy `sverklo_*` names in the disable list", () => {
    // Users may have SVERKLO_DISABLED_TOOLS=sverklo_forget,sverklo_remember
    // from before the rename. The canonicalizer strips the prefix so both
    // forms keep working through the deprecation window.
    process.env.SVERKLO_DISABLED_TOOLS = "sverklo_forget,sverklo_remember";
    __resetToolOverrideCache();

    const result = applyToolOverrides(fixture());
    expect(result.map((t) => t.name)).toEqual(["search", "refs"]);
  });

  it("v0.28.0 back-compat: mixed legacy + canonical names both apply", () => {
    process.env.SVERKLO_DISABLED_TOOLS = "sverklo_forget,remember";
    __resetToolOverrideCache();

    const result = applyToolOverrides(fixture());
    expect(result.map((t) => t.name)).toEqual(["search", "refs"]);
  });
});

describe("applyToolOverrides — combined overrides", () => {
  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SVERKLO_TOOL_") || key === "SVERKLO_DISABLED_TOOLS" || key === "SVERKLO_PROFILE") {
        delete process.env[key];
      }
    }
    __resetToolOverrideCache();
  });

  it("applies description overrides and disable list together", () => {
    process.env.SVERKLO_TOOL_SEARCH_DESCRIPTION = "custom";
    process.env.SVERKLO_DISABLED_TOOLS = "forget";
    __resetToolOverrideCache();

    const result = applyToolOverrides(fixture());
    expect(result).toHaveLength(3);
    expect(result.find((t) => t.name === "search")?.description).toBe("custom");
    expect(result.find((t) => t.name === "forget")).toBeUndefined();
  });
});

describe("applyToolOverrides — SVERKLO_PROFILE filter", () => {
  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SVERKLO_TOOL_") || key === "SVERKLO_DISABLED_TOOLS" || key === "SVERKLO_PROFILE") {
        delete process.env[key];
      }
    }
    __resetToolOverrideCache();
  });

  it("returns all tools when no profile is set", () => {
    const result = applyToolOverrides(fixture());
    expect(result).toHaveLength(4);
  });

  it("returns all tools when profile=full (explicit no-op)", () => {
    process.env.SVERKLO_PROFILE = "full";
    __resetToolOverrideCache();
    const result = applyToolOverrides(fixture());
    expect(result).toHaveLength(4);
  });

  it("filters to core profile (search + refs in fixture; forget + remember out)", () => {
    // Fixture has search + refs + forget + remember; core keeps the first two.
    process.env.SVERKLO_PROFILE = "core";
    __resetToolOverrideCache();
    const result = applyToolOverrides(fixture());
    expect(result.map((t) => t.name)).toEqual(["search", "refs"]);
  });

  it("filters to lean profile (keeps memory tools)", () => {
    process.env.SVERKLO_PROFILE = "lean";
    __resetToolOverrideCache();
    const result = applyToolOverrides(fixture());
    expect(result.map((t) => t.name)).toEqual(["search", "refs", "remember"]);
  });

  it("ignores unknown profile names with a warning (no filter applied)", () => {
    process.env.SVERKLO_PROFILE = "doesnotexist";
    __resetToolOverrideCache();
    const result = applyToolOverrides(fixture());
    expect(result).toHaveLength(4);
  });

  it("composes with disabled list (profile + disabled both apply)", () => {
    process.env.SVERKLO_PROFILE = "lean";
    process.env.SVERKLO_DISABLED_TOOLS = "remember";
    __resetToolOverrideCache();
    const result = applyToolOverrides(fixture());
    expect(result.map((t) => t.name)).toEqual(["search", "refs"]);
  });
});

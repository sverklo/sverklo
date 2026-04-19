import { describe, it, expect, beforeEach } from "vitest";
import { applyToolOverrides, __resetToolOverrideCache } from "./tool-overrides.js";

// applyToolOverrides ships on every MCP session start and previously
// had zero test coverage. These tests lock in the env-var override +
// disable-list contract so a refactor can't silently change how tool
// visibility or descriptions are controlled.

const fixture = () => [
  { name: "sverklo_search", description: "orig search", inputSchema: {} },
  { name: "sverklo_refs", description: "orig refs", inputSchema: {} },
  { name: "sverklo_forget", description: "orig forget", inputSchema: {} },
  { name: "sverklo_remember", description: "orig remember", inputSchema: {} },
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
    expect(result.find((t) => t.name === "sverklo_search")?.description).toBe("orig search");
  });

  it("overrides a tool description via SVERKLO_TOOL_<NAME>_DESCRIPTION", () => {
    process.env.SVERKLO_TOOL_SEARCH_DESCRIPTION = "use only for architecture decisions";
    __resetToolOverrideCache();

    const result = applyToolOverrides(fixture());
    expect(result.find((t) => t.name === "sverklo_search")?.description).toBe(
      "use only for architecture decisions"
    );
    // Other tools unchanged
    expect(result.find((t) => t.name === "sverklo_refs")?.description).toBe("orig refs");
  });

  it("strips sverklo_ prefix when matching env var suffix", () => {
    // Both SEARCH and REVIEW_DIFF-style names should work.
    process.env.SVERKLO_TOOL_REMEMBER_DESCRIPTION = "project decision log only";
    __resetToolOverrideCache();

    const result = applyToolOverrides(fixture());
    expect(result.find((t) => t.name === "sverklo_remember")?.description).toBe(
      "project decision log only"
    );
  });

  it("handles multi-word tool names (underscore-separated)", () => {
    const tools = [
      { name: "sverklo_review_diff", description: "orig", inputSchema: {} },
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
    expect(result.find((t) => t.name === "sverklo_search")?.description).toBe("orig search");
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
    process.env.SVERKLO_DISABLED_TOOLS = "sverklo_forget";
    __resetToolOverrideCache();

    const result = applyToolOverrides(fixture());
    expect(result.map((t) => t.name)).not.toContain("sverklo_forget");
    expect(result).toHaveLength(3);
  });

  it("hides multiple comma-separated tools", () => {
    process.env.SVERKLO_DISABLED_TOOLS = "sverklo_forget,sverklo_remember";
    __resetToolOverrideCache();

    const result = applyToolOverrides(fixture());
    expect(result.map((t) => t.name)).toEqual(["sverklo_search", "sverklo_refs"]);
  });

  it("trims whitespace in the disabled list", () => {
    process.env.SVERKLO_DISABLED_TOOLS = " sverklo_forget , sverklo_remember ";
    __resetToolOverrideCache();

    const result = applyToolOverrides(fixture());
    expect(result).toHaveLength(2);
  });

  it("ignores unknown tool names in the disabled list (no-op)", () => {
    process.env.SVERKLO_DISABLED_TOOLS = "sverklo_nonexistent,sverklo_search";
    __resetToolOverrideCache();

    const result = applyToolOverrides(fixture());
    expect(result).toHaveLength(3);
    expect(result.map((t) => t.name)).not.toContain("sverklo_search");
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
    process.env.SVERKLO_DISABLED_TOOLS = "sverklo_forget";
    __resetToolOverrideCache();

    const result = applyToolOverrides(fixture());
    expect(result).toHaveLength(3);
    expect(result.find((t) => t.name === "sverklo_search")?.description).toBe("custom");
    expect(result.find((t) => t.name === "sverklo_forget")).toBeUndefined();
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
    expect(result.map((t) => t.name)).toEqual(["sverklo_search", "sverklo_refs"]);
  });

  it("filters to lean profile (keeps memory tools)", () => {
    process.env.SVERKLO_PROFILE = "lean";
    __resetToolOverrideCache();
    const result = applyToolOverrides(fixture());
    expect(result.map((t) => t.name)).toEqual(["sverklo_search", "sverklo_refs", "sverklo_remember"]);
  });

  it("ignores unknown profile names with a warning (no filter applied)", () => {
    process.env.SVERKLO_PROFILE = "doesnotexist";
    __resetToolOverrideCache();
    const result = applyToolOverrides(fixture());
    expect(result).toHaveLength(4);
  });

  it("composes with disabled list (profile + disabled both apply)", () => {
    process.env.SVERKLO_PROFILE = "lean";
    process.env.SVERKLO_DISABLED_TOOLS = "sverklo_remember";
    __resetToolOverrideCache();
    const result = applyToolOverrides(fixture());
    expect(result.map((t) => t.name)).toEqual(["sverklo_search", "sverklo_refs"]);
  });
});

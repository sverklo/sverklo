import { describe, it, expect } from "vitest";
import {
  LEGACY_TOOL_ALIASES,
  resolveToolName,
} from "../mcp-server.js";

// Regression tests for v0.28.0 #71 — the MCP tool-name rename.
//
// Pre-v0.28.0, tools were named `sverklo_X` and `resolveToolName`
// didn't exist. The whole file would fail to import on the
// unpatched code (Principle VI.3). After v0.28.0 these tests
// lock in three behaviors:
//
//   1. The alias map covers every renamed tool (no dropped entries).
//   2. resolveToolName routes legacy → canonical correctly.
//   3. The deprecation warning fires exactly once per legacy name
//      per server instance — agents that call sverklo_search 200
//      times in a session shouldn't see 200 warnings.

describe("v0.28.0 #71 — legacy tool-name alias resolution", () => {
  it("exports LEGACY_TOOL_ALIASES with ≥30 entries (the rename was substantive)", () => {
    expect(Object.keys(LEGACY_TOOL_ALIASES).length).toBeGreaterThanOrEqual(30);
  });

  it("every alias key has the sverklo_ prefix and every value does NOT", () => {
    for (const [legacy, canonical] of Object.entries(LEGACY_TOOL_ALIASES)) {
      expect(legacy.startsWith("sverklo_")).toBe(true);
      expect(canonical.startsWith("sverklo_")).toBe(false);
      // The canonical name should be the legacy name minus the prefix.
      expect(legacy).toBe(`sverklo_${canonical}`);
    }
  });

  it("resolveToolName routes a legacy name to its canonical form", () => {
    const warned = new Set<string>();
    const messages: string[] = [];
    const result = resolveToolName("sverklo_search", warned, (m) => messages.push(m));
    expect(result).toBe("search");
  });

  it("resolveToolName passes a canonical name through unchanged with no warning", () => {
    const warned = new Set<string>();
    const messages: string[] = [];
    const result = resolveToolName("search", warned, (m) => messages.push(m));
    expect(result).toBe("search");
    expect(messages).toHaveLength(0);
  });

  it("resolveToolName passes an unknown name through unchanged", () => {
    // e.g. Zilliz compat aliases or any tool we don't know about
    const warned = new Set<string>();
    const messages: string[] = [];
    const result = resolveToolName("totally_unknown_thing", warned, (m) => messages.push(m));
    expect(result).toBe("totally_unknown_thing");
    expect(messages).toHaveLength(0);
  });

  it("emits a deprecation warning the FIRST time a legacy name is seen", () => {
    const warned = new Set<string>();
    const messages: string[] = [];
    resolveToolName("sverklo_search", warned, (m) => messages.push(m));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("[sverklo:DEPRECATED]");
    expect(messages[0]).toContain("sverklo_search");
    expect(messages[0]).toContain("search");
    expect(messages[0]).toContain("v0.29.0");
  });

  it("emits the warning EXACTLY ONCE per legacy name, not on every call", () => {
    // Agents that call sverklo_search 200 times in a single session
    // shouldn't get 200 warning lines on stderr. The Set<string> in
    // the dispatch loop is what makes this work.
    const warned = new Set<string>();
    const messages: string[] = [];
    for (let i = 0; i < 50; i++) {
      resolveToolName("sverklo_search", warned, (m) => messages.push(m));
    }
    expect(messages).toHaveLength(1);
  });

  it("warns separately for different legacy names (one warning each)", () => {
    const warned = new Set<string>();
    const messages: string[] = [];
    resolveToolName("sverklo_search", warned, (m) => messages.push(m));
    resolveToolName("sverklo_lookup", warned, (m) => messages.push(m));
    resolveToolName("sverklo_search", warned, (m) => messages.push(m)); // dup, ignored
    resolveToolName("sverklo_impact", warned, (m) => messages.push(m));
    expect(messages).toHaveLength(3); // one per distinct legacy name
    expect(messages.some((m) => m.includes("sverklo_search"))).toBe(true);
    expect(messages.some((m) => m.includes("sverklo_lookup"))).toBe(true);
    expect(messages.some((m) => m.includes("sverklo_impact"))).toBe(true);
  });
});

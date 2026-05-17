import { describe, it, expect } from "vitest";
import { toJSON, toHuman, emptyReport } from "./reporter.js";
import type { AuditReport } from "./types.js";

const baseReport = (over: Partial<AuditReport> = {}): AuditReport => ({
  ...emptyReport("HEAD"),
  ...over,
});

describe("toJSON", () => {
  it("emits schema_version 1 and stable field order", () => {
    const r = baseReport();
    const parsed = JSON.parse(toJSON(r));
    expect(parsed.schema_version).toBe("1");
    expect(parsed.pass).toBe(true);
    expect(parsed.diff.base_ref).toBe("HEAD");
    expect(Array.isArray(parsed.violations)).toBe(true);
    expect(Array.isArray(parsed.pre_existing)).toBe(true);
    expect(typeof parsed.stats.elapsed_ms).toBe("number");
  });

  it("serializes a cycle violation", () => {
    const r = baseReport({
      pass: false,
      violations: [
        { kind: "cycle", nodes: ["a.ts", "b.ts"], newInThisDiff: true },
      ],
    });
    const parsed = JSON.parse(toJSON(r));
    expect(parsed.violations[0]).toEqual({
      kind: "cycle",
      nodes: ["a.ts", "b.ts"],
      newInThisDiff: true,
    });
  });
});

describe("toHuman", () => {
  it("returns empty string on pass without verbose", () => {
    expect(toHuman(baseReport(), false)).toBe("");
  });

  it("renders a cycle violation block", () => {
    const r = baseReport({
      pass: false,
      violations: [
        { kind: "cycle", nodes: ["a.ts", "b.ts"], newInThisDiff: true },
      ],
    });
    const out = toHuman(r, false);
    expect(out).toContain("✗ audit-diff: new circular dependency");
    expect(out).toContain("a.ts");
    expect(out).toContain("b.ts");
  });

  it("renders a fan-in spike block with counts and threshold", () => {
    const r = baseReport({
      pass: false,
      violations: [
        {
          kind: "fan_in_spike",
          file: "util.ts",
          preFanIn: 47,
          postFanIn: 52,
          threshold: 50,
          newInThisDiff: true,
        },
      ],
    });
    const out = toHuman(r, false);
    expect(out).toContain("util.ts");
    expect(out).toContain("47");
    expect(out).toContain("52");
    expect(out).toContain("50");
  });

  it("renders both blocks when both violation kinds present", () => {
    const r = baseReport({
      pass: false,
      violations: [
        { kind: "cycle", nodes: ["a.ts", "b.ts"], newInThisDiff: true },
        {
          kind: "fan_in_spike",
          file: "util.ts",
          preFanIn: 47,
          postFanIn: 52,
          threshold: 50,
          newInThisDiff: true,
        },
      ],
    });
    const out = toHuman(r, false);
    expect(out).toContain("circular dependency");
    expect(out).toContain("fan-in threshold crossed");
  });

  it("prints stats on pass with verbose", () => {
    const r = baseReport({
      stats: { boundary_node_count: 5, boundary_edge_count: 8, elapsed_ms: 123 },
    });
    const out = toHuman(r, true);
    expect(out).toContain("boundary_nodes=5");
    expect(out).toContain("elapsed_ms=123");
  });
});

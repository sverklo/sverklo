import { describe, it, expect } from "vitest";
import { detectFanInSpikes, parseThreshold } from "./fan-in.js";
import type { BoundarySubgraph, NodeLookup } from "./types.js";

function snap(
  snapshot: "pre" | "post",
  fanIn: Record<number, number>,
): BoundarySubgraph {
  return {
    nodes: new Set(Object.keys(fanIn).map(Number)),
    edges: new Map(),
    fanIn: new Map(Object.entries(fanIn).map(([k, v]) => [Number(k), v])),
    seedNodes: new Set(),
    snapshot,
  };
}

const lookup: NodeLookup = {
  idToPath: new Map([
    [1, "util.ts"],
    [2, "core.ts"],
    [3, "untouched.ts"],
  ]),
  pathToId: new Map(),
};

describe("detectFanInSpikes", () => {
  it("flags below→above as a new violation", () => {
    const pre = snap("pre", { 1: 47 });
    const post = snap("post", { 1: 52 });
    const out = detectFanInSpikes(pre, post, 50, lookup);
    expect(out).toEqual([
      {
        kind: "fan_in_spike",
        file: "util.ts",
        preFanIn: 47,
        postFanIn: 52,
        threshold: 50,
        newInThisDiff: true,
      },
    ]);
  });

  it("flags above→above as pre-existing (newInThisDiff: false)", () => {
    const pre = snap("pre", { 2: 60 });
    const post = snap("post", { 2: 65 });
    const out = detectFanInSpikes(pre, post, 50, lookup);
    expect(out.length).toBe(1);
    expect(out[0]!.newInThisDiff).toBe(false);
  });

  it("does not flag below→below", () => {
    const pre = snap("pre", { 3: 10 });
    const post = snap("post", { 3: 11 });
    expect(detectFanInSpikes(pre, post, 50, lookup)).toEqual([]);
  });

  it("treats missing pre fan-in as 0 (brand-new file)", () => {
    const pre = snap("pre", {});
    const post = snap("post", { 1: 55 });
    const out = detectFanInSpikes(pre, post, 50, lookup);
    expect(out[0]!.preFanIn).toBe(0);
    expect(out[0]!.newInThisDiff).toBe(true);
  });
});

describe("parseThreshold", () => {
  it("parses positive integers", () => {
    expect(parseThreshold("50")).toBe(50);
    expect(parseThreshold("1")).toBe(1);
  });

  it("rejects zero", () => {
    expect(parseThreshold("0")).toBeNull();
  });

  it("rejects negative", () => {
    expect(parseThreshold("-5")).toBeNull();
  });

  it("rejects non-integer", () => {
    expect(parseThreshold("3.14")).toBeNull();
    expect(parseThreshold("abc")).toBeNull();
    expect(parseThreshold("")).toBeNull();
  });
});

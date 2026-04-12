import { describe, it, expect, vi } from "vitest";
import { handleSearch } from "./search.js";

// Integration tests for the handleSearch footer behavior (issue #4).
// These lock in what users see when confidence is low, medium, or
// high — the visible contract of the tool, which a pure unit test
// of computeConfidence wouldn't catch.

// We mock hybridSearchWithConfidence so these tests don't need a real
// index. The mock drives each confidence branch independently.

vi.mock("../../search/hybrid-search.js", async () => {
  return {
    hybridSearchWithConfidence: vi.fn(async () => ({
      results: [],
      confidence: "high" as const,
      confidenceReason: null,
      fallbackHint: null,
    })),
    formatResults: (results: unknown[]) =>
      results.length === 0 ? "No results found." : "formatted",
  };
});

import { hybridSearchWithConfidence } from "../../search/hybrid-search.js";
const mockedHybrid = hybridSearchWithConfidence as unknown as ReturnType<typeof vi.fn>;

describe("handleSearch — confidence footer", () => {
  it("high confidence: no footer attached", async () => {
    mockedHybrid.mockResolvedValueOnce({
      results: [],
      confidence: "high",
      confidenceReason: null,
      fallbackHint: null,
    });

    const out = await handleSearch({} as never, { query: "retry logic" });
    expect(out).not.toContain("Low confidence");
    expect(out).not.toContain("Medium confidence");
  });

  it("low confidence: surfaces warning + fallback hint", async () => {
    mockedHybrid.mockResolvedValueOnce({
      results: [],
      confidence: "low",
      confidenceReason: "no results matched",
      fallbackHint: "Try Grep for exact string matching.",
    });

    const out = await handleSearch({} as never, { query: "x" });
    expect(out).toContain("⚠️");
    expect(out).toContain("Low confidence");
    expect(out).toContain("no results matched");
    expect(out).toContain("Try Grep");
  });

  it("low confidence on framework-wiring: hint names annotations", async () => {
    mockedHybrid.mockResolvedValueOnce({
      results: [],
      confidence: "low",
      confidenceReason: "framework wiring",
      fallbackHint:
        "This query looks like a framework-wiring question. Try Grep for `@Component`.",
    });

    const out = await handleSearch({} as never, {
      query: "how is the interceptor registered",
    });
    expect(out).toContain("framework-wiring");
    expect(out).toContain("@Component");
  });

  it("medium confidence with hint: attaches soft hint", async () => {
    mockedHybrid.mockResolvedValueOnce({
      results: [],
      confidence: "medium",
      confidenceReason: "ambiguous top two",
      fallbackHint: "Consider reading both or refining the query.",
    });

    const out = await handleSearch({} as never, { query: "auth" });
    expect(out).toContain("Medium confidence");
    expect(out).toContain("ambiguous top two");
  });

  it("medium confidence with no hint: no footer", async () => {
    mockedHybrid.mockResolvedValueOnce({
      results: [],
      confidence: "medium",
      confidenceReason: "mild",
      fallbackHint: null,
    });

    const out = await handleSearch({} as never, { query: "x" });
    expect(out).not.toContain("Medium confidence");
    expect(out).not.toContain("Low confidence");
  });

  it("passes args through to hybridSearchWithConfidence", async () => {
    mockedHybrid.mockClear();
    mockedHybrid.mockResolvedValueOnce({
      results: [],
      confidence: "high",
      confidenceReason: null,
      fallbackHint: null,
    });

    await handleSearch({} as never, {
      query: "test",
      token_budget: 3000,
      scope: "src/api/",
      language: "typescript",
      type: "function",
    });

    expect(mockedHybrid).toHaveBeenCalledTimes(1);
    const call = mockedHybrid.mock.calls[0][1];
    expect(call.query).toBe("test");
    expect(call.tokenBudget).toBe(3000);
    expect(call.scope).toBe("src/api/");
    expect(call.language).toBe("typescript");
    expect(call.type).toBe("function");
  });

  it("defaults token budget to 4000 when not provided", async () => {
    mockedHybrid.mockClear();
    mockedHybrid.mockResolvedValueOnce({
      results: [],
      confidence: "high",
      confidenceReason: null,
      fallbackHint: null,
    });

    await handleSearch({} as never, { query: "x" });

    const call = mockedHybrid.mock.calls[0][1];
    expect(call.tokenBudget).toBe(4000);
  });
});

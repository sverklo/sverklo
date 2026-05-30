import { describe, expect, it } from "vitest";
import { computeOpportunityScore } from "./scoring.js";

describe("opportunity scoring", () => {
  it("scores current code-intelligence topics as high relevance", () => {
    const score = computeOpportunityScore(
      {
        id: "trend",
        text: "Developers want local-first code intelligence for coding agents",
        source_context: "MCP repo memory conversation",
        observed_at: "2026-05-30T14:00:00Z",
      },
      "2026-05-30T15:00:00Z",
    );
    expect(score.sverklo_relevance).toBe("high");
    expect(score.urgency).toBe("high");
    expect(score.total).toBeGreaterThan(70);
  });

  it("penalizes unrelated or risky topics", () => {
    const unrelated = computeOpportunityScore(
      {
        id: "trend",
        text: "Celebrity sports giveaway recipe",
        source_context: "Unrelated trend",
        observed_at: "2026-05-30T14:00:00Z",
      },
      "2026-05-30T15:00:00Z",
    );
    const risky = computeOpportunityScore(
      {
        id: "trend",
        text: "Cursor vs Windsurf competitor drama",
        source_context: "Sensitive competitor comparison",
        observed_at: "2026-05-30T14:00:00Z",
      },
      "2026-05-30T15:00:00Z",
    );
    expect(unrelated.sverklo_relevance).toBe("low");
    expect(risky.brand_safety_risk).toBe("high");
  });
});

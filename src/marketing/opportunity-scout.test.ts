import { describe, expect, it } from "vitest";
import { runOpportunityScout } from "./opportunity-scout.js";
import { trendFixture, workspaceFixture } from "./test-fixtures.js";

describe("opportunity scout", () => {
  it("returns ranked opportunities, rejected topics, and needs-review risk flags", () => {
    const result = runOpportunityScout(trendFixture(), workspaceFixture(), {
      now: "2026-05-30T15:00:00Z",
    });
    expect(result.opportunities).toHaveLength(10);
    expect(result.opportunities[0].score).toBeGreaterThanOrEqual(result.opportunities[1].score);
    expect(result.opportunities.some((item) => item.status === "rejected")).toBe(true);
    expect(result.opportunities.some((item) => item.status === "needs_review")).toBe(true);
    expect(result.briefs.length).toBeGreaterThan(0);
  });

  it("rejects blocked topics before briefing", () => {
    const result = runOpportunityScout(
      trendFixture(),
      workspaceFixture({ blocked_topics: ["local-first coding agents"] }),
      { now: "2026-05-30T15:00:00Z" },
    );
    const blocked = result.opportunities.find((item) => item.source_item_id === "trend-001");
    expect(blocked?.status).toBe("rejected");
    expect(blocked?.blockers.join(" ")).toContain("blocked topic");
  });
});

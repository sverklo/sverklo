import { describe, expect, it } from "vitest";
import { buildStatusSummary, renderStatusText } from "./status.js";
import { runCampaignCycle } from "./campaign-cycle.js";
import { profileFixture, recentPostsFixture, trendFixture, workspaceFixture } from "./test-fixtures.js";

describe("marketing status", () => {
  it("renders concise text and JSON-friendly status shape", () => {
    const workspace = workspaceFixture();
    const cycle = runCampaignCycle({
      workspace,
      trendSnapshot: trendFixture(),
      profileSnapshot: profileFixture(),
      recentPosts: recentPostsFixture(),
      now: "2026-05-30T15:00:00Z",
    });
    const summary = buildStatusSummary(cycle);
    expect(summary.counts.opportunities).toBe(10);
    expect(summary.next_action.length).toBeGreaterThan(0);
    expect(renderStatusText(summary)).toContain("Sverklo marketing:");
  });

  it("handles missing cycles", () => {
    expect(buildStatusSummary().status).toBe("not_initialized");
  });
});

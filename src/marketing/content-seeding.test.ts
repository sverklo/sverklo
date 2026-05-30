import { describe, expect, it } from "vitest";
import { applyOperatorDecision, createOperatorDecision } from "./decisions.js";
import { runCampaignCycle } from "./campaign-cycle.js";
import { buildContentQueue } from "./content-seeding.js";
import { evidenceFixture, recentPostsFixture, trendFixture, workspaceFixture } from "./test-fixtures.js";

describe("content seeding", () => {
  it("generates seed drafts from approved opportunity briefs and evergreen themes", () => {
    const workspace = workspaceFixture();
    const cycle = runCampaignCycle({ workspace, trendSnapshot: trendFixture(), now: "2026-05-30T15:00:00Z" });
    const opportunity = cycle.opportunities.find((item) => item.status === "briefed")!;
    applyOperatorDecision(
      workspace,
      cycle,
      createOperatorDecision({
        targetType: "opportunity",
        targetId: opportunity.opportunity_id,
        decision: "approve",
        now: "2026-05-30T15:01:00Z",
      }),
    );
    const queue = buildContentQueue(cycle, workspace, evidenceFixture(), recentPostsFixture());
    expect(queue.items.some((item) => item.source_opportunity_id === opportunity.opportunity_id)).toBe(true);
    expect(queue.items.some((item) => item.theme === "release discipline")).toBe(true);
    expect(queue.items.every((item) => item.approval_status !== "approved")).toBe(true);
  });
});

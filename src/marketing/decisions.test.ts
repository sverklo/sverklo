import { describe, expect, it } from "vitest";
import { applyOperatorDecision, createOperatorDecision } from "./decisions.js";
import { runCampaignCycle } from "./campaign-cycle.js";
import { trendFixture, workspaceFixture } from "./test-fixtures.js";

describe("operator decisions", () => {
  it("approves an opportunity and linked brief", () => {
    const workspace = workspaceFixture();
    const cycle = runCampaignCycle({
      workspace,
      trendSnapshot: trendFixture(),
      now: "2026-05-30T15:00:00Z",
    });
    const first = cycle.opportunities.find((item) => item.status === "briefed");
    expect(first).toBeDefined();
    applyOperatorDecision(
      workspace,
      cycle,
      createOperatorDecision({
        targetType: "opportunity",
        targetId: first!.opportunity_id,
        decision: "approve",
        now: "2026-05-30T15:01:00Z",
      }),
    );
    expect(cycle.opportunities.find((item) => item.opportunity_id === first!.opportunity_id)?.status).toBe("approved");
    expect(cycle.briefs.find((item) => item.opportunity_id === first!.opportunity_id)?.approval_status).toBe("approved");
  });

  it("records future rejections as blocked topics", () => {
    const workspace = workspaceFixture();
    const cycle = runCampaignCycle({ workspace, trendSnapshot: trendFixture(), now: "2026-05-30T15:00:00Z" });
    applyOperatorDecision(
      workspace,
      cycle,
      createOperatorDecision({
        targetType: "opportunity",
        targetId: cycle.opportunities[0].opportunity_id,
        decision: "reject",
        reason: "No competitor drama",
        future: true,
        now: "2026-05-30T15:02:00Z",
      }),
    );
    expect(workspace.blocked_topics).toContain("No competitor drama");
  });
});

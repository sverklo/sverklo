import { describe, expect, it } from "vitest";
import { applyOperatorDecision, createOperatorDecision } from "./decisions.js";
import { runCampaignCycle } from "./campaign-cycle.js";
import {
  evidenceFixture,
  profileFixture,
  recentPostsFixture,
  trendFixture,
  workspaceFixture,
} from "./test-fixtures.js";

describe("campaign cycle", () => {
  it("coordinates agent handoffs and readiness blockers", () => {
    const workspace = workspaceFixture();
    let cycle = runCampaignCycle({
      workspace,
      trendSnapshot: trendFixture(),
      profileSnapshot: profileFixture(),
      recentPosts: recentPostsFixture(),
      evidence: evidenceFixture(),
      now: "2026-05-30T15:00:00Z",
    });
    expect(cycle.opportunities.length).toBeGreaterThan(0);
    expect(cycle.profile_report?.score).toBeGreaterThanOrEqual(85);
    expect(cycle.top_blocker).toBe("No approved credibility content");

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
    cycle = runCampaignCycle({
      workspace,
      existingCycle: cycle,
      profileSnapshot: profileFixture(),
      recentPosts: recentPostsFixture(),
      evidence: evidenceFixture(),
      now: "2026-05-30T15:02:00Z",
    });
    expect(cycle.content_queue?.items.some((item) => item.source_opportunity_id === opportunity.opportunity_id)).toBe(true);
  });

  it("keeps future rejected directions in workspace memory", () => {
    const workspace = workspaceFixture();
    const cycle = runCampaignCycle({ workspace, trendSnapshot: trendFixture(), now: "2026-05-30T15:00:00Z" });
    applyOperatorDecision(
      workspace,
      cycle,
      createOperatorDecision({
        targetType: "opportunity",
        targetId: cycle.opportunities[0].opportunity_id,
        decision: "reject",
        reason: "Do not use competitor drama",
        future: true,
        now: "2026-05-30T15:01:00Z",
      }),
    );
    expect(workspace.blocked_topics).toContain("Do not use competitor drama");
  });

  it("preserves rejected opportunities across scout reruns", () => {
    const workspace = workspaceFixture();
    let cycle = runCampaignCycle({ workspace, trendSnapshot: trendFixture(), now: "2026-05-30T15:00:00Z" });
    const opportunity = cycle.opportunities.find((item) => item.status === "briefed")!;

    applyOperatorDecision(
      workspace,
      cycle,
      createOperatorDecision({
        targetType: "opportunity",
        targetId: opportunity.opportunity_id,
        decision: "reject",
        reason: "Keep this angle out",
        now: "2026-05-30T15:01:00Z",
      }),
    );

    cycle = runCampaignCycle({
      workspace,
      existingCycle: cycle,
      trendSnapshot: trendFixture(),
      now: "2026-05-30T15:02:00Z",
    });

    const rerunOpportunity = cycle.opportunities.find((item) => item.source_item_id === opportunity.source_item_id);
    expect(rerunOpportunity?.status).toBe("rejected");
  });

  it("ignores rejected content blockers when computing readiness", () => {
    const workspace = workspaceFixture();
    let cycle = runCampaignCycle({
      workspace,
      profileSnapshot: profileFixture(),
      recentPosts: recentPostsFixture(),
      evidence: evidenceFixture(),
      now: "2026-05-30T15:00:00Z",
    });
    const approvedItem = cycle.content_queue!.items.find((item) => item.quality_status === "passed")!;
    const blockedItems = cycle.content_queue!.items.filter((item) => item.blockers.length > 0);
    expect(blockedItems.length).toBeGreaterThan(0);

    applyOperatorDecision(
      workspace,
      cycle,
      createOperatorDecision({
        targetType: "content_item",
        targetId: approvedItem.content_id,
        decision: "approve",
        now: "2026-05-30T15:01:00Z",
      }),
    );
    blockedItems.forEach((item, index) => {
      applyOperatorDecision(
        workspace,
        cycle,
        createOperatorDecision({
          targetType: "content_item",
          targetId: item.content_id,
          decision: "reject",
          reason: "Do not repeat this angle",
          now: `2026-05-30T15:0${index + 2}:00Z`,
        }),
      );
    });

    cycle = runCampaignCycle({
      workspace,
      existingCycle: cycle,
      profileSnapshot: profileFixture(),
      recentPosts: recentPostsFixture(),
      evidence: evidenceFixture(),
      now: "2026-05-30T15:05:00Z",
    });

    expect(cycle.top_blocker).toBeUndefined();
    expect(cycle.status).toBe("ready");
  });
});

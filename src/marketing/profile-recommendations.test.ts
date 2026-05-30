import { describe, expect, it } from "vitest";
import { applyOperatorDecision, createOperatorDecision } from "./decisions.js";
import { runCampaignCycle } from "./campaign-cycle.js";
import { profileFixture, recentPostsFixture, workspaceFixture } from "./test-fixtures.js";

describe("profile recommendation transitions", () => {
  it("accepts and records applied profile recommendations", () => {
    const workspace = workspaceFixture();
    const weakProfile = { ...profileFixture(), bio: "Tools.", pinned_post: "" };
    const cycle = runCampaignCycle({
      workspace,
      profileSnapshot: weakProfile,
      recentPosts: recentPostsFixture(),
      now: "2026-05-30T15:00:00Z",
    });
    const rec = cycle.profile_report!.recommendations[0];
    applyOperatorDecision(
      workspace,
      cycle,
      createOperatorDecision({
        targetType: "profile_recommendation",
        targetId: rec.recommendation_id,
        decision: "approve",
        now: "2026-05-30T15:01:00Z",
      }),
    );
    expect(rec.status).toBe("accepted");
    applyOperatorDecision(
      workspace,
      cycle,
      createOperatorDecision({
        targetType: "profile_recommendation",
        targetId: rec.recommendation_id,
        decision: "record_applied",
        now: "2026-05-30T15:02:00Z",
      }),
    );
    expect(rec.status).toBe("applied");
  });
});

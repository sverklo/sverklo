import { describe, expect, it } from "vitest";
import { evaluateProfileHealth } from "./profile-health.js";
import { profileFixture, recentPostsFixture } from "./test-fixtures.js";

describe("profile health", () => {
  it("scores a credible local-first profile above readiness threshold", () => {
    const report = evaluateProfileHealth(
      profileFixture(),
      recentPostsFixture(),
      { cycle_id: "cycle-test" },
      "2026-05-30T15:00:00Z",
    );
    expect(report.score).toBeGreaterThanOrEqual(85);
    expect(report.critical_gaps).toHaveLength(0);
  });

  it("flags unclear and inactive profiles", () => {
    const report = evaluateProfileHealth(
      {
        captured_at: "2026-05-30T15:00:00Z",
        account_handle: "@sverklo",
        display_name: "Sverklo",
        bio: "Tools.",
      },
      { captured_at: "2026-05-30T15:00:00Z", posts: [] },
      { cycle_id: "cycle-test" },
      "2026-05-30T15:00:00Z",
    );
    expect(report.score).toBeLessThan(85);
    expect(report.critical_gaps.length).toBeGreaterThan(0);
  });
});

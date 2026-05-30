import { describe, expect, it } from "vitest";
import { evaluateContentQuality } from "./content-quality.js";
import { evidenceFixture, recentPostsFixture, workspaceFixture } from "./test-fixtures.js";
import type { SeedContentItem } from "./models.js";

function item(overrides: Partial<SeedContentItem>): SeedContentItem {
  return {
    content_id: "content-001",
    content_type: "single_post",
    text: "Sverklo reduces repo-search token waste by 35x.",
    goal: "credibility",
    theme: "benchmark",
    intended_audience: "developers",
    quality_status: "unchecked",
    approval_status: "draft",
    evidence_refs: [],
    blockers: [],
    ...overrides,
  };
}

describe("content quality", () => {
  it("blocks unverified claims and link-bearing originating posts", () => {
    const result = evaluateContentQuality(item({ text: "Sverklo is 35x faster. https://sverklo.com" }), {
      workspace: workspaceFixture(),
      evidence: evidenceFixture(),
    });
    expect(result.quality_status).toBe("blocked");
    expect(result.blockers).toContain("public product claim lacks evidence reference");
    expect(result.blockers).toContain("originating post contains a link");
  });

  it("passes evidence-backed non-repeated content", () => {
    const result = evaluateContentQuality(
      item({
        text: "Sverklo benchmark methodology is public.",
        evidence_refs: ["bench-readme-001"],
        theme: "bench methodology",
      }),
      { workspace: workspaceFixture(), evidence: evidenceFixture(), recentPosts: recentPostsFixture() },
    );
    expect(result.quality_status).toBe("passed");
  });
});

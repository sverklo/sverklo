import { describe, expect, it } from "vitest";
import {
  assertEvidenceCatalog,
  assertProfileSnapshot,
  assertRecentPostsSnapshot,
  assertTrendSnapshot,
  looksPrivateOrConfidential,
  normalizeAccountHandle,
  textMatchesBlockedTopic,
} from "./validation.js";
import {
  evidenceFixture,
  profileFixture,
  recentPostsFixture,
  trendFixture,
  workspaceFixture,
} from "./test-fixtures.js";

describe("marketing validation", () => {
  it("validates fixture inputs and normalizes handles", () => {
    expect(normalizeAccountHandle("sverklo")).toBe("@sverklo");
    expect(() => assertTrendSnapshot(trendFixture())).not.toThrow();
    expect(() => assertProfileSnapshot(profileFixture())).not.toThrow();
    expect(() => assertRecentPostsSnapshot(recentPostsFixture())).not.toThrow();
    expect(() => assertEvidenceCatalog(evidenceFixture())).not.toThrow();
  });

  it("detects blocked topics and private information", () => {
    const workspace = workspaceFixture({ blocked_topics: ["competitor drama"] });
    expect(textMatchesBlockedTopic(workspace, "Avoid competitor drama today")).toBe("competitor drama");
    expect(looksPrivateOrConfidential("Reach me at person@example.com")).toBe(true);
  });
});

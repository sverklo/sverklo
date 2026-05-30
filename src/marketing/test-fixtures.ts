import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  CampaignWorkspace,
  EvidenceCatalog,
  ProfileSnapshot,
  RecentPostsSnapshot,
  TrendSnapshot,
} from "./models.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

export function fixtureJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf-8")) as T;
}

export function trendFixture(): TrendSnapshot {
  return fixtureJson<TrendSnapshot>("trend-snapshot.json");
}

export function evidenceFixture(): EvidenceCatalog {
  return fixtureJson<EvidenceCatalog>("evidence.json");
}

export function recentPostsFixture(): RecentPostsSnapshot {
  return fixtureJson<RecentPostsSnapshot>("recent-posts.json");
}

export function profileFixture(): ProfileSnapshot {
  return fixtureJson<ProfileSnapshot>("profile-snapshot.json");
}

export function workspaceFixture(overrides: Partial<CampaignWorkspace> = {}): CampaignWorkspace {
  return {
    workspace_id: "workspace-test",
    account_handle: "@sverklo",
    positioning_phrases: ["local-first code intel", "repo memory for coding agents"],
    blocked_topics: [],
    created_at: "2026-05-30T15:00:00Z",
    updated_at: "2026-05-30T15:00:00Z",
    ...overrides,
  };
}

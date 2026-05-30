import type {
  CampaignWorkspace,
  EvidenceCatalog,
  RecentPostsSnapshot,
  SeedContentItem,
} from "./models.js";
import { textMatchesBlockedTopic } from "./validation.js";

export interface QualityResult {
  quality_status: SeedContentItem["quality_status"];
  blockers: string[];
}

export function evaluateContentQuality(
  item: SeedContentItem,
  context: {
    workspace: CampaignWorkspace;
    evidence?: EvidenceCatalog;
    recentPosts?: RecentPostsSnapshot;
  },
): QualityResult {
  const blockers: string[] = [];
  const blockedTopic = textMatchesBlockedTopic(context.workspace, `${item.text} ${item.theme}`);
  if (blockedTopic) blockers.push(`matches blocked topic: ${blockedTopic}`);
  if (containsLink(item.text) && item.content_type !== "reply_suggestion") {
    blockers.push("originating post contains a link");
  }
  if (containsEngagementBait(item.text)) {
    blockers.push("contains engagement bait");
  }
  if (containsPublicProductClaim(item.text) && !hasEvidence(item, context.evidence)) {
    blockers.push("public product claim lacks evidence reference");
  }
  if (isRepeatedAngle(item, context.recentPosts)) {
    blockers.push("duplicates a recent angle");
  }
  return {
    quality_status: blockers.length > 0 ? "blocked" : "passed",
    blockers,
  };
}

export function containsPublicProductClaim(text: string): boolean {
  return /\b(\d+x|\d+%|faster|fewer|reduces|reduced|best|beats|outperforms|benchmark|leader)\b/i.test(text);
}

function containsLink(text: string): boolean {
  return /https?:\/\/\S+/i.test(text);
}

function containsEngagementBait(text: string): boolean {
  return /\b(like and repost|like\/repost|follow us|smash|reply below|what do you think)\b/i.test(text);
}

function hasEvidence(item: SeedContentItem, evidence?: EvidenceCatalog): boolean {
  if (item.evidence_refs.length === 0) return false;
  const valid = new Set((evidence?.items ?? []).filter((ref) => !ref.stale).map((ref) => ref.evidence_id));
  return item.evidence_refs.some((ref) => valid.has(ref));
}

function isRepeatedAngle(item: SeedContentItem, recentPosts?: RecentPostsSnapshot): boolean {
  if (!recentPosts) return false;
  const theme = item.theme.toLowerCase();
  return recentPosts.posts.some((post) => {
    const haystack = `${post.theme ?? ""} ${post.text}`.toLowerCase();
    return haystack.includes(theme) || normalizedStart(haystack) === normalizedStart(item.text);
  });
}

function normalizedStart(text: string): string {
  return text.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).slice(0, 8).join(" ");
}

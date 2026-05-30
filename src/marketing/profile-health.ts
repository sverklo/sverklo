import type {
  CampaignCycle,
  ProfileHealthReport,
  ProfileRecommendation,
  ProfileSnapshot,
  RecentPostsSnapshot,
} from "./models.js";
import { assertProfileSnapshot, assertRecentPostsSnapshot } from "./validation.js";

export function evaluateProfileHealth(
  profile: ProfileSnapshot,
  recentPosts: RecentPostsSnapshot | undefined,
  cycle: Pick<CampaignCycle, "cycle_id" | "content_queue">,
  now = new Date().toISOString(),
): ProfileHealthReport {
  assertProfileSnapshot(profile);
  if (recentPosts) assertRecentPostsSnapshot(recentPosts);

  const clarityScore = scoreClarity(profile);
  const credibilityScore = scoreCredibility(profile);
  const alignmentScore = scoreAlignment(profile, cycle);
  const cadenceScore = scoreCadence(recentPosts, now);
  const score = Math.round((clarityScore + credibilityScore + alignmentScore + cadenceScore) / 4);
  const reportId = `profile-${cycle.cycle_id}`;
  const criticalGaps: string[] = [];
  const recommendations: ProfileRecommendation[] = [];

  addRecommendation(recommendations, reportId, "bio", clarityScore, "Clarify bio around local-first code intelligence.", "Visitors understand what Sverklo does in one scan.");
  addRecommendation(recommendations, reportId, "credibility_signal", credibilityScore, "Add a concrete proof point or benchmark-backed claim.", "Visitors see why the account is worth trusting.");
  addRecommendation(recommendations, reportId, "pinned_content", alignmentScore, "Refresh pinned content to match active campaign themes.", "Campaign visitors land on a relevant proof point.");
  addRecommendation(recommendations, reportId, "cadence", cadenceScore, "Restore a visible posting cadence before launch.", "The account looks active and maintained.");

  if (clarityScore < 70) criticalGaps.push("unclear positioning in bio");
  if (credibilityScore < 70) criticalGaps.push("missing credibility signal");
  if (alignmentScore < 70) criticalGaps.push("profile theme mismatch");
  if (cadenceScore < 50) criticalGaps.push("posting cadence is stale");

  return {
    report_id: reportId,
    cycle_id: cycle.cycle_id,
    score,
    clarity_score: clarityScore,
    credibility_score: credibilityScore,
    alignment_score: alignmentScore,
    cadence_score: cadenceScore,
    recommendations,
    critical_gaps: criticalGaps,
  };
}

function scoreClarity(profile: ProfileSnapshot): number {
  const text = `${profile.display_name} ${profile.bio}`.toLowerCase();
  let score = 40;
  if (text.includes("sverklo")) score += 20;
  if (text.includes("code") || text.includes("repo")) score += 20;
  if (text.includes("agent") || text.includes("mcp")) score += 10;
  if (text.includes("local")) score += 10;
  return Math.min(100, score);
}

function scoreCredibility(profile: ProfileSnapshot): number {
  let score = 45;
  const text = `${profile.bio} ${profile.pinned_post ?? ""}`.toLowerCase();
  if (profile.pinned_post?.trim()) score += 20;
  if (text.includes("benchmark") || text.includes("local-first") || text.includes("open-source") || text.includes("mit")) score += 25;
  if (profile.profile_link?.startsWith("http")) score += 10;
  return Math.min(100, score);
}

function scoreAlignment(profile: ProfileSnapshot, cycle: Pick<CampaignCycle, "content_queue">): number {
  const themes = cycle.content_queue?.items.map((item) => item.theme.toLowerCase()) ?? [];
  const profileText = `${profile.bio} ${profile.pinned_post ?? ""}`.toLowerCase();
  if (themes.length === 0) return profileText.includes("sverklo") ? 80 : 50;
  const matches = themes.filter((theme) => profileText.includes(theme) || theme.split(/\s+/).some((part) => profileText.includes(part)));
  return Math.min(100, 50 + matches.length * 15);
}

function scoreCadence(recentPosts: RecentPostsSnapshot | undefined, now: string): number {
  if (!recentPosts || recentPosts.posts.length === 0) return 20;
  const newestAgeDays = Math.min(
    ...recentPosts.posts.map((post) => Math.max(0, Date.parse(now) - Date.parse(post.posted_at)) / 864e5),
  );
  let score = recentPosts.posts.length >= 3 ? 60 : 45;
  if (newestAgeDays <= 7) score += 30;
  else if (newestAgeDays <= 14) score += 15;
  return Math.min(100, score);
}

function addRecommendation(
  recommendations: ProfileRecommendation[],
  reportId: string,
  area: ProfileRecommendation["profile_area"],
  score: number,
  recommendation: string,
  impact: string,
): void {
  if (score >= 85) return;
  const priority: ProfileRecommendation["priority"] = score < 50 ? "critical" : score < 70 ? "high" : "medium";
  recommendations.push({
    recommendation_id: `profile-rec-${String(recommendations.length + 1).padStart(3, "0")}`,
    report_id: reportId,
    profile_area: area,
    recommendation,
    reason: `${area} score is ${score}`,
    expected_visitor_impact: impact,
    priority,
    status: "proposed",
  });
}

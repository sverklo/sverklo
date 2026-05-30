import type {
  CampaignWorkspace,
  MarketingOpportunity,
  OpportunityBrief,
  TrendSnapshot,
} from "./models.js";
import { computeOpportunityScore, opportunityTopic } from "./scoring.js";
import { assertTrendSnapshot, looksPrivateOrConfidential, textMatchesBlockedTopic } from "./validation.js";

export interface OpportunityScoutResult {
  opportunities: MarketingOpportunity[];
  briefs: OpportunityBrief[];
}

export function runOpportunityScout(
  snapshot: TrendSnapshot,
  workspace: CampaignWorkspace,
  options: { now?: string } = {},
): OpportunityScoutResult {
  assertTrendSnapshot(snapshot);
  const opportunities: MarketingOpportunity[] = [];
  const briefs: OpportunityBrief[] = [];
  const now = options.now ?? new Date().toISOString();

  snapshot.items.forEach((item, index) => {
    const score = computeOpportunityScore(item, now);
    const blockers: string[] = [];
    const text = `${item.text} ${item.source_context}`;
    const blockedTopic = textMatchesBlockedTopic(workspace, text);
    if (blockedTopic) blockers.push(`matches blocked topic: ${blockedTopic}`);
    if (looksPrivateOrConfidential(text)) blockers.push("contains private or confidential information");
    if (score.sverklo_relevance === "low") blockers.push("low Sverklo relevance");
    if (score.audience_fit === "low") blockers.push("low audience fit");
    if (score.urgency === "low") blockers.push("stale or low-urgency topic");

    let status: MarketingOpportunity["status"] = "briefed";
    if (blockers.length > 0) status = "rejected";
    else if (score.brand_safety_risk === "high" || score.brand_safety_risk === "medium") status = "needs_review";

    const opportunityId = `opp-${String(index + 1).padStart(3, "0")}`;
    const angle = recommendedAngle(item.text, workspace.positioning_phrases[0] ?? "local-first code intel");
    opportunities.push({
      opportunity_id: opportunityId,
      source_item_id: item.id,
      topic: opportunityTopic(item.text) || item.id,
      source_context: item.source_context,
      audience_fit: score.audience_fit,
      sverklo_relevance: score.sverklo_relevance,
      urgency: score.urgency,
      novelty: score.novelty,
      credibility_impact: score.credibility_impact,
      brand_safety_risk: score.brand_safety_risk,
      score: score.total,
      recommended_angle: angle,
      status,
      blockers,
      rationale: score.reasons,
    });

    if (status !== "rejected") {
      briefs.push({
        brief_id: `brief-${String(briefs.length + 1).padStart(3, "0")}`,
        opportunity_id: opportunityId,
        summary: item.text,
        why_now: score.urgency === "high" ? "Current conversation is active now." : "Relevant during this campaign cycle.",
        target_audience: score.audience_fit === "high" ? "AI coding and developer-tool builders" : "Developer-tool audience",
        message_angle: angle,
        risk_flags: score.brand_safety_risk === "low" ? [] : [`${score.brand_safety_risk} brand-safety risk`],
        approval_status: "pending",
      });
    }
  });

  opportunities.sort((a, b) => b.score - a.score || a.opportunity_id.localeCompare(b.opportunity_id));
  return { opportunities, briefs };
}

function recommendedAngle(text: string, phrase: string): string {
  const lower = text.toLowerCase();
  if (lower.includes("memory")) return `Connect the conversation to ${phrase} and git-pinned decisions.`;
  if (lower.includes("mcp")) return `Show how ${phrase} improves MCP agent workflows.`;
  if (lower.includes("local")) return `Lead with the local-first privacy angle behind ${phrase}.`;
  return `Add a terse technical Sverklo example around ${phrase}.`;
}

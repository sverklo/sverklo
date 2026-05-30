import type { CampaignCycle, CampaignStatusSummary } from "./models.js";

export function buildStatusSummary(cycle?: CampaignCycle): CampaignStatusSummary {
  if (!cycle) {
    return {
      status: "not_initialized",
      profile_score: 0,
      content_coverage_days: 0,
      next_action: "Initialize a marketing workspace and run a campaign cycle",
      counts: { opportunities: 0, content_items: 0, profile_recommendations: 0, pending_decisions: 0 },
    };
  }
  const contentItems = cycle.content_queue?.items ?? [];
  const recommendations = cycle.profile_report?.recommendations ?? [];
  const pendingOpportunities = cycle.opportunities.filter((item) => item.status === "needs_review" || item.status === "briefed").length;
  const pendingContent = contentItems.filter((item) => item.approval_status === "draft" || item.approval_status === "needs_revision").length;
  const pendingProfile = recommendations.filter((item) => item.status === "proposed").length;
  const nextAction = nextActionFor(cycle, pendingOpportunities, pendingContent, pendingProfile);

  return {
    cycle_id: cycle.cycle_id,
    status: cycle.status,
    profile_score: cycle.profile_report?.score ?? 0,
    content_coverage_days: cycle.content_queue?.coverage_days ?? 0,
    top_opportunity_id: cycle.opportunities[0]?.opportunity_id,
    next_action: nextAction,
    top_blocker: cycle.top_blocker,
    counts: {
      opportunities: cycle.opportunities.length,
      content_items: contentItems.length,
      profile_recommendations: recommendations.length,
      pending_decisions: pendingOpportunities + pendingContent + pendingProfile,
    },
  };
}

export function renderStatusText(summary: CampaignStatusSummary): string {
  if (summary.status === "not_initialized") return `Sverklo marketing: ${summary.next_action}\n`;
  return [
    `Sverklo marketing: ${summary.status}`,
    `Cycle: ${summary.cycle_id}`,
    `Profile score: ${summary.profile_score}`,
    `Content coverage days: ${summary.content_coverage_days}`,
    `Top opportunity: ${summary.top_opportunity_id ?? "none"}`,
    `Next action: ${summary.next_action}`,
    `Top blocker: ${summary.top_blocker ?? "none"}`,
    `Counts: ${summary.counts.opportunities} opportunities, ${summary.counts.content_items} content items, ${summary.counts.profile_recommendations} profile recommendations, ${summary.counts.pending_decisions} pending decisions`,
  ].join("\n") + "\n";
}

function nextActionFor(
  cycle: CampaignCycle,
  pendingOpportunities: number,
  pendingContent: number,
  pendingProfile: number,
): string {
  if (cycle.status === "ready") return "Campaign is ready for operator-managed posting";
  if (pendingOpportunities > 0) return `Approve or reject ${pendingOpportunities} opportunity briefs`;
  if (pendingContent > 0) return `Review ${pendingContent} content drafts`;
  if (pendingProfile > 0) return `Review ${pendingProfile} profile recommendations`;
  return cycle.top_blocker ? `Resolve blocker: ${cycle.top_blocker}` : "Run a campaign cycle with fresh inputs";
}

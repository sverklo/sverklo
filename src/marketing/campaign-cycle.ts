import type {
  CampaignCycle,
  CampaignWorkspace,
  EvidenceCatalog,
  ProfileSnapshot,
  RecentPostsSnapshot,
  TrendSnapshot,
} from "./models.js";
import { runOpportunityScout } from "./opportunity-scout.js";
import { buildContentQueue } from "./content-seeding.js";
import { evaluateProfileHealth } from "./profile-health.js";

export interface CampaignCycleInput {
  workspace: CampaignWorkspace;
  existingCycle?: CampaignCycle;
  trendSnapshot?: TrendSnapshot;
  profileSnapshot?: ProfileSnapshot;
  recentPosts?: RecentPostsSnapshot;
  evidence?: EvidenceCatalog;
  cycleId?: string;
  now?: string;
}

export function runCampaignCycle(input: CampaignCycleInput): CampaignCycle {
  const now = input.now ?? new Date().toISOString();
  const existing = input.existingCycle;
  const cycle: CampaignCycle = existing
    ? structuredClone(existing)
    : {
        cycle_id: input.cycleId ?? `cycle-${now.slice(0, 10)}`,
        status: "collecting_inputs",
        period_start: now,
        period_end: now,
        opportunity_ids: [],
        content_item_ids: [],
        opportunities: [],
        briefs: [],
        decisions: [],
        created_at: now,
        updated_at: now,
      };

  cycle.updated_at = now;
  cycle.period_end = now;

  if (input.trendSnapshot) {
    const scout = runOpportunityScout(input.trendSnapshot, input.workspace, { now });
    preserveOperatorStates(cycle, scout);
    cycle.opportunities = scout.opportunities;
    cycle.briefs = scout.briefs;
    cycle.opportunity_ids = scout.opportunities.map((item) => item.opportunity_id);
  }

  const contentQueue = buildContentQueue(cycle, input.workspace, input.evidence, input.recentPosts);
  if (existing?.content_queue) preserveContentStates(existing.content_queue, contentQueue);
  cycle.content_queue = contentQueue;
  cycle.content_item_ids = cycle.content_queue.items.map((item) => item.content_id);

  if (input.profileSnapshot) {
    cycle.profile_report = evaluateProfileHealth(input.profileSnapshot, input.recentPosts, cycle, now);
    if (existing?.profile_report) preserveProfileRecommendationStates(existing.profile_report, cycle.profile_report);
    cycle.profile_report_id = cycle.profile_report.report_id;
  }

  cycle.top_blocker = topBlocker(cycle);
  recomputeCampaignReadiness(cycle);
  input.workspace.active_cycle_id = cycle.cycle_id;
  input.workspace.updated_at = now;
  return cycle;
}

function preserveContentStates(
  previous: NonNullable<CampaignCycle["content_queue"]>,
  next: NonNullable<CampaignCycle["content_queue"]>,
): void {
  for (const item of next.items) {
    const prior = previous.items.find((candidate) =>
      (item.source_opportunity_id && candidate.source_opportunity_id === item.source_opportunity_id) ||
      (!item.source_opportunity_id && candidate.theme === item.theme),
    );
    if (!prior) continue;
    if (["approved", "scheduled", "published", "rejected"].includes(prior.approval_status)) {
      item.approval_status = prior.approval_status;
    }
  }
  next.coverage_days = next.items.filter((item) => ["approved", "scheduled", "published"].includes(item.approval_status)).length;
}

function preserveProfileRecommendationStates(
  previous: NonNullable<CampaignCycle["profile_report"]>,
  next: NonNullable<CampaignCycle["profile_report"]>,
): void {
  for (const recommendation of next.recommendations) {
    const prior = previous.recommendations.find((candidate) => candidate.profile_area === recommendation.profile_area);
    if (prior && ["accepted", "applied", "rejected", "superseded"].includes(prior.status)) {
      recommendation.status = prior.status;
    }
  }
}

export function recomputeCampaignReadiness(cycle: CampaignCycle): void {
  if (cycle.status === "closed") return;
  cycle.top_blocker = topBlocker(cycle);
  cycle.status = cycle.top_blocker ? "operator_review" : "ready";
}

function preserveOperatorStates(
  existing: CampaignCycle,
  scout: Pick<CampaignCycle, "opportunities" | "briefs">,
): void {
  for (const opportunity of scout.opportunities) {
    const previous = existing.opportunities.find((item) => item.source_item_id === opportunity.source_item_id);
    if (previous && ["approved", "archived", "rejected"].includes(previous.status)) {
      opportunity.status = previous.status;
    }
  }
  for (const brief of scout.briefs) {
    const previousOpportunity = existing.opportunities.find((item) => item.opportunity_id === brief.opportunity_id);
    const previousBrief = existing.briefs.find((item) => item.opportunity_id === previousOpportunity?.opportunity_id);
    if (previousBrief && ["approved", "rejected", "revision_requested"].includes(previousBrief.approval_status)) {
      brief.approval_status = previousBrief.approval_status;
    }
  }
}

function topBlocker(cycle: CampaignCycle): string | undefined {
  if (cycle.profile_report && cycle.profile_report.score < 85) {
    return `Profile score below 85 (${cycle.profile_report.score})`;
  }
  if (cycle.profile_report?.critical_gaps.length) {
    return cycle.profile_report.critical_gaps[0];
  }
  if (!cycle.content_queue?.items.some((item) => ["approved", "scheduled", "published"].includes(item.approval_status))) {
    return "No approved credibility content";
  }
  const blockedContent = cycle.content_queue?.items.find(
    (item) => item.approval_status !== "rejected" && item.blockers.length > 0,
  );
  if (blockedContent) return `${blockedContent.content_id}: ${blockedContent.blockers[0]}`;
  if (cycle.opportunities.some((item) => item.status === "needs_review")) {
    return "One or more opportunities need operator review";
  }
  return undefined;
}

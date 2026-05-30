import type {
  CampaignCycle,
  CampaignWorkspace,
  OperatorDecision,
  ProfileRecommendation,
  SeedContentItem,
} from "./models.js";
import { assertDecision } from "./validation.js";

export function createOperatorDecision(input: {
  targetType: OperatorDecision["target_type"];
  targetId: string;
  decision: OperatorDecision["decision"];
  reason?: string;
  future?: boolean;
  now?: string;
}): OperatorDecision {
  const now = input.now ?? new Date().toISOString();
  return {
    decision_id: `decision-${now.replace(/[^0-9]/g, "").slice(0, 14)}-${input.targetId}`,
    target_type: input.targetType,
    target_id: input.targetId,
    decision: input.decision,
    reason: input.reason,
    created_at: now,
    applies_to_future_cycles: Boolean(input.future),
  };
}

export function applyOperatorDecision(
  workspace: CampaignWorkspace,
  cycle: CampaignCycle,
  decision: OperatorDecision,
): void {
  assertDecision(decision);
  const changed = applyToTarget(cycle, decision);
  if (!changed) throw new Error(`decision target not found: ${decision.target_type} ${decision.target_id}`);
  cycle.decisions.push(decision);
  if (decision.applies_to_future_cycles && decision.reason && shouldBlockFuture(decision.decision)) {
    const normalized = decision.reason.trim();
    if (normalized && !workspace.blocked_topics.some((topic) => topic.toLowerCase() === normalized.toLowerCase())) {
      workspace.blocked_topics.push(normalized);
    }
  }
  const now = decision.created_at;
  workspace.updated_at = now;
  cycle.updated_at = now;
}

function shouldBlockFuture(decision: OperatorDecision["decision"]): boolean {
  return decision === "reject" || decision === "request_revision";
}

function applyToTarget(cycle: CampaignCycle, decision: OperatorDecision): boolean {
  if (decision.target_type === "opportunity") {
    const opportunity = cycle.opportunities.find((item) => item.opportunity_id === decision.target_id);
    if (!opportunity) return false;
    if (decision.decision === "approve") opportunity.status = "approved";
    else if (decision.decision === "reject") opportunity.status = "rejected";
    else if (decision.decision === "archive") opportunity.status = "archived";
    else if (decision.decision === "request_revision") opportunity.status = "needs_review";
    else throw new Error(`invalid decision for opportunity: ${decision.decision}`);
    const brief = cycle.briefs.find((item) => item.opportunity_id === opportunity.opportunity_id);
    if (brief && decision.decision === "approve") brief.approval_status = "approved";
    if (brief && decision.decision === "reject") brief.approval_status = "rejected";
    if (brief && decision.decision === "request_revision") brief.approval_status = "revision_requested";
    return true;
  }

  if (decision.target_type === "brief") {
    const brief = cycle.briefs.find((item) => item.brief_id === decision.target_id);
    if (!brief) return false;
    if (decision.decision === "approve") brief.approval_status = "approved";
    else if (decision.decision === "reject") brief.approval_status = "rejected";
    else if (decision.decision === "request_revision") brief.approval_status = "revision_requested";
    else throw new Error(`invalid decision for brief: ${decision.decision}`);
    return true;
  }

  if (decision.target_type === "content_item") {
    const content = cycle.content_queue?.items.find((item) => item.content_id === decision.target_id);
    if (!content) return false;
    applyContentDecision(content, decision);
    return true;
  }

  if (decision.target_type === "profile_recommendation") {
    const recommendation = cycle.profile_report?.recommendations.find(
      (item) => item.recommendation_id === decision.target_id,
    );
    if (!recommendation) return false;
    applyProfileDecision(recommendation, decision);
    return true;
  }

  if (decision.target_type === "campaign_cycle") {
    if (cycle.cycle_id !== decision.target_id) return false;
    if (decision.decision === "archive") cycle.status = "closed";
    else if (decision.decision === "approve") cycle.status = "ready";
    else if (decision.decision === "request_revision") cycle.status = "operator_review";
    else throw new Error(`invalid decision for campaign cycle: ${decision.decision}`);
    return true;
  }

  return false;
}

function applyContentDecision(content: SeedContentItem, decision: OperatorDecision): void {
  if (decision.decision === "approve") {
    if (content.quality_status !== "passed") {
      throw new Error(`content item ${content.content_id} cannot be approved until quality checks pass`);
    }
    content.approval_status = "approved";
  } else if (decision.decision === "reject") {
    content.approval_status = "rejected";
  } else if (decision.decision === "request_revision") {
    content.approval_status = "needs_revision";
  } else if (decision.decision === "record_published") {
    if (content.approval_status !== "scheduled" && content.approval_status !== "approved") {
      throw new Error(`content item ${content.content_id} must be approved or scheduled before publish`);
    }
    content.approval_status = "published";
  } else if (decision.decision === "archive") {
    content.approval_status = "rejected";
  } else {
    throw new Error(`invalid decision for content item: ${decision.decision}`);
  }
}

function applyProfileDecision(recommendation: ProfileRecommendation, decision: OperatorDecision): void {
  if (decision.decision === "approve") recommendation.status = "accepted";
  else if (decision.decision === "reject") recommendation.status = "rejected";
  else if (decision.decision === "record_applied") {
    if (recommendation.status !== "accepted") {
      throw new Error(`profile recommendation ${recommendation.recommendation_id} must be accepted before applied`);
    }
    recommendation.status = "applied";
  } else if (decision.decision === "archive") recommendation.status = "superseded";
  else throw new Error(`invalid decision for profile recommendation: ${decision.decision}`);
}

export type ScoreLevel = "low" | "medium" | "high";
export type CampaignStatus =
  | "planned"
  | "collecting_inputs"
  | "agent_review"
  | "operator_review"
  | "ready"
  | "closed";
export type OpportunityStatus = "discovered" | "rejected" | "needs_review" | "briefed" | "approved" | "archived";
export type BriefApprovalStatus = "pending" | "approved" | "rejected" | "revision_requested";
export type ContentType = "single_post" | "thread" | "reply_suggestion" | "profile_pin_candidate";
export type ContentQualityStatus = "unchecked" | "passed" | "needs_revision" | "blocked";
export type ContentApprovalStatus = "draft" | "needs_revision" | "approved" | "scheduled" | "published" | "rejected";
export type ProfileArea = "bio" | "display_name" | "visuals" | "pinned_content" | "link" | "cadence" | "credibility_signal";
export type Priority = "low" | "medium" | "high" | "critical";
export type ProfileRecommendationStatus = "proposed" | "accepted" | "rejected" | "applied" | "superseded";
export type DecisionTargetType =
  | "opportunity"
  | "brief"
  | "content_item"
  | "profile_recommendation"
  | "campaign_cycle";
export type DecisionValue =
  | "approve"
  | "reject"
  | "request_revision"
  | "record_published"
  | "record_applied"
  | "archive";
export type EvidenceSourceType = "benchmark" | "release_note" | "readme" | "blog_post" | "manual_approval";

export interface CampaignWorkspace {
  workspace_id: string;
  account_handle: string;
  active_cycle_id?: string;
  positioning_phrases: string[];
  blocked_topics: string[];
  created_at: string;
  updated_at: string;
}

export interface CampaignCycle {
  cycle_id: string;
  status: CampaignStatus;
  period_start: string;
  period_end: string;
  opportunity_ids: string[];
  content_item_ids: string[];
  profile_report_id?: string;
  top_blocker?: string;
  opportunities: MarketingOpportunity[];
  briefs: OpportunityBrief[];
  content_queue?: ContentQueue;
  profile_report?: ProfileHealthReport;
  decisions: OperatorDecision[];
  created_at: string;
  updated_at: string;
}

export interface TrendSnapshotItem {
  id: string;
  text: string;
  source_context: string;
  observed_at?: string;
}

export interface TrendSnapshot {
  snapshot_id?: string;
  captured_at: string;
  source_label: string;
  source_notes?: string;
  items: TrendSnapshotItem[];
}

export interface RecentPost {
  id: string;
  text: string;
  posted_at: string;
  theme?: string;
}

export interface RecentPostsSnapshot {
  captured_at: string;
  account_handle?: string;
  posts: RecentPost[];
}

export interface ProfileSnapshot {
  captured_at: string;
  account_handle: string;
  display_name: string;
  bio: string;
  pinned_post?: string;
  pinned_post_at?: string;
  profile_link?: string;
  visual_notes?: string;
}

export interface OpportunityScore {
  audience_fit: ScoreLevel;
  sverklo_relevance: ScoreLevel;
  urgency: ScoreLevel;
  novelty: ScoreLevel;
  credibility_impact: ScoreLevel;
  brand_safety_risk: ScoreLevel;
  total: number;
  reasons: string[];
}

export interface MarketingOpportunity {
  opportunity_id: string;
  source_item_id: string;
  topic: string;
  source_context: string;
  audience_fit: ScoreLevel;
  sverklo_relevance: ScoreLevel;
  urgency: ScoreLevel;
  novelty: ScoreLevel;
  credibility_impact: ScoreLevel;
  brand_safety_risk: ScoreLevel;
  score: number;
  recommended_angle: string;
  status: OpportunityStatus;
  blockers: string[];
  rationale: string[];
}

export interface OpportunityBrief {
  brief_id: string;
  opportunity_id: string;
  summary: string;
  why_now: string;
  target_audience: string;
  message_angle: string;
  risk_flags: string[];
  approval_status: BriefApprovalStatus;
}

export interface SeedContentItem {
  content_id: string;
  content_type: ContentType;
  text: string;
  goal: string;
  theme: string;
  source_opportunity_id?: string;
  intended_audience: string;
  quality_status: ContentQualityStatus;
  approval_status: ContentApprovalStatus;
  scheduled_for?: string;
  evidence_refs: string[];
  blockers: string[];
}

export interface ContentQueue {
  queue_id: string;
  cycle_id: string;
  items: SeedContentItem[];
  coverage_days: number;
  gaps: string[];
}

export interface ProfileHealthReport {
  report_id: string;
  cycle_id: string;
  score: number;
  clarity_score: number;
  credibility_score: number;
  alignment_score: number;
  cadence_score: number;
  recommendations: ProfileRecommendation[];
  critical_gaps: string[];
}

export interface ProfileRecommendation {
  recommendation_id: string;
  report_id: string;
  profile_area: ProfileArea;
  recommendation: string;
  reason: string;
  expected_visitor_impact: string;
  priority: Priority;
  status: ProfileRecommendationStatus;
}

export interface OperatorDecision {
  decision_id: string;
  target_type: DecisionTargetType;
  target_id: string;
  decision: DecisionValue;
  reason?: string;
  created_at: string;
  applies_to_future_cycles: boolean;
}

export interface EvidenceReference {
  evidence_id: string;
  claim: string;
  source_type: EvidenceSourceType;
  source_path_or_url: string;
  verified_at: string;
  notes?: string;
  stale?: boolean;
}

export interface EvidenceCatalog {
  items: EvidenceReference[];
}

export interface CampaignStatusSummary {
  cycle_id?: string;
  status: CampaignStatus | "not_initialized";
  profile_score: number;
  content_coverage_days: number;
  top_opportunity_id?: string;
  next_action: string;
  top_blocker?: string;
  counts: {
    opportunities: number;
    content_items: number;
    profile_recommendations: number;
    pending_decisions: number;
  };
}

export const DEFAULT_POSITIONING_PHRASES = [
  "local-first code intel",
  "repo memory for coding agents",
];

import type { CampaignCycle } from "./models.js";

export function renderOpportunityReport(cycle: CampaignCycle): string {
  const lines = [`# Opportunities: ${cycle.cycle_id}`, ""];
  for (const opp of cycle.opportunities) {
    lines.push(`## ${opp.opportunity_id}: ${opp.topic}`);
    lines.push("");
    lines.push(`- Status: ${opp.status}`);
    lines.push(`- Score: ${opp.score}`);
    lines.push(`- Audience fit: ${opp.audience_fit}`);
    lines.push(`- Sverklo relevance: ${opp.sverklo_relevance}`);
    lines.push(`- Urgency: ${opp.urgency}`);
    lines.push(`- Brand risk: ${opp.brand_safety_risk}`);
    lines.push(`- Angle: ${opp.recommended_angle}`);
    if (opp.blockers.length > 0) lines.push(`- Blockers: ${opp.blockers.join("; ")}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function renderContentReport(cycle: CampaignCycle): string {
  const lines = [`# Content Queue: ${cycle.cycle_id}`, ""];
  const queue = cycle.content_queue;
  if (!queue) return `${lines.join("\n")}No content queue generated.\n`;
  lines.push(`Coverage days: ${queue.coverage_days}`);
  if (queue.gaps.length > 0) lines.push(`Gaps: ${queue.gaps.join("; ")}`);
  lines.push("");
  for (const item of queue.items) {
    lines.push(`## ${item.content_id}: ${item.theme}`);
    lines.push("");
    lines.push(`- Approval: ${item.approval_status}`);
    lines.push(`- Quality: ${item.quality_status}`);
    lines.push(`- Audience: ${item.intended_audience}`);
    lines.push(`- Goal: ${item.goal}`);
    if (item.blockers.length > 0) lines.push(`- Blockers: ${item.blockers.join("; ")}`);
    lines.push("");
    lines.push(item.text);
    lines.push("");
  }
  return lines.join("\n");
}

export function renderProfileHealthReport(cycle: CampaignCycle): string {
  const report = cycle.profile_report;
  if (!report) return `# Profile Health: ${cycle.cycle_id}\n\nNo profile health report generated.\n`;
  const lines = [`# Profile Health: ${cycle.cycle_id}`, ""];
  lines.push(`Score: ${report.score}`);
  lines.push(`Clarity: ${report.clarity_score}`);
  lines.push(`Credibility: ${report.credibility_score}`);
  lines.push(`Alignment: ${report.alignment_score}`);
  lines.push(`Cadence: ${report.cadence_score}`);
  if (report.critical_gaps.length > 0) lines.push(`Critical gaps: ${report.critical_gaps.join("; ")}`);
  lines.push("");
  for (const rec of report.recommendations) {
    lines.push(`## ${rec.recommendation_id}: ${rec.profile_area}`);
    lines.push("");
    lines.push(`- Priority: ${rec.priority}`);
    lines.push(`- Status: ${rec.status}`);
    lines.push(`- Recommendation: ${rec.recommendation}`);
    lines.push(`- Visitor impact: ${rec.expected_visitor_impact}`);
    lines.push("");
  }
  return lines.join("\n");
}

import type {
  CampaignCycle,
  CampaignWorkspace,
  ContentQueue,
  EvidenceCatalog,
  OpportunityBrief,
  RecentPostsSnapshot,
  SeedContentItem,
} from "./models.js";
import { evaluateContentQuality } from "./content-quality.js";

const EVERGREEN_THEMES = [
  "code intelligence",
  "memory",
  "MCP workflow",
  "release discipline",
  "developer productivity",
];

export function buildContentQueue(
  cycle: CampaignCycle,
  workspace: CampaignWorkspace,
  evidence?: EvidenceCatalog,
  recentPosts?: RecentPostsSnapshot,
): ContentQueue {
  const items: SeedContentItem[] = [];
  const approvedBriefs = cycle.briefs.filter((brief) => brief.approval_status === "approved");
  for (const brief of approvedBriefs) {
    items.push(contentFromBrief(brief, items.length + 1, evidence));
  }
  for (const theme of EVERGREEN_THEMES) {
    if (items.some((item) => item.theme.toLowerCase() === theme.toLowerCase())) continue;
    items.push(evergreenContent(theme, items.length + 1, evidence));
  }

  const checked = items.map((item) => {
    const result = evaluateContentQuality(item, { workspace, evidence, recentPosts });
    return {
      ...item,
      quality_status: result.quality_status,
      approval_status: result.quality_status === "passed" ? item.approval_status : "needs_revision",
      blockers: result.blockers,
    } satisfies SeedContentItem;
  });

  return {
    queue_id: `queue-${cycle.cycle_id}`,
    cycle_id: cycle.cycle_id,
    items: checked,
    coverage_days: coverageDays(checked),
    gaps: queueGaps(checked),
  };
}

function contentFromBrief(brief: OpportunityBrief, index: number, evidence?: EvidenceCatalog): SeedContentItem {
  return {
    content_id: `content-${String(index).padStart(3, "0")}`,
    content_type: "single_post",
    text: `Sverklo angle: ${brief.message_angle} Context: ${brief.summary}`,
    goal: "Join a timely developer-tool conversation with a credible Sverklo point of view.",
    theme: inferTheme(brief.message_angle),
    source_opportunity_id: brief.opportunity_id,
    intended_audience: brief.target_audience,
    quality_status: "unchecked",
    approval_status: "draft",
    evidence_refs: defaultEvidenceRefs(evidence),
    blockers: [],
  };
}

function evergreenContent(theme: string, index: number, evidence?: EvidenceCatalog): SeedContentItem {
  return {
    content_id: `content-${String(index).padStart(3, "0")}`,
    content_type: "single_post",
    text: `Sverklo note: ${evergreenMessage(theme)}`,
    goal: "Build account credibility with a useful evergreen product theme.",
    theme,
    intended_audience: "AI coding and developer-tool builders",
    quality_status: "unchecked",
    approval_status: "draft",
    evidence_refs: defaultEvidenceRefs(evidence),
    blockers: [],
  };
}

function evergreenMessage(theme: string): string {
  if (theme === "code intelligence") return "code search gets better when the agent can see symbols, callers, and dependency shape.";
  if (theme === "memory") return "repo decisions should be tied to git state so agents do not reuse stale context.";
  if (theme === "MCP workflow") return "MCP tools work best when they return ranked evidence instead of raw file dumps.";
  if (theme === "release discipline") return "small releases keep the blast radius small and make regressions easier to isolate.";
  return "developer productivity improves when the agent reads the real repo before editing.";
}

function inferTheme(messageAngle: string): string {
  const lower = messageAngle.toLowerCase();
  if (lower.includes("mcp")) return "MCP workflow";
  if (lower.includes("memory") || lower.includes("decision")) return "memory";
  if (lower.includes("local")) return "local-first code intel";
  return "code intelligence";
}

function defaultEvidenceRefs(evidence?: EvidenceCatalog): string[] {
  const first = evidence?.items.find((item) => !item.stale);
  return first ? [first.evidence_id] : [];
}

function coverageDays(items: SeedContentItem[]): number {
  return items.filter((item) => ["approved", "scheduled", "published"].includes(item.approval_status)).length;
}

function queueGaps(items: SeedContentItem[]): string[] {
  const gaps: string[] = [];
  if (items.filter((item) => item.quality_status === "passed").length < 5) {
    gaps.push("fewer than five quality-passed draft items");
  }
  if (!items.some((item) => item.theme.toLowerCase().includes("memory"))) gaps.push("missing memory theme");
  if (!items.some((item) => item.theme.toLowerCase().includes("mcp"))) gaps.push("missing MCP workflow theme");
  return gaps;
}

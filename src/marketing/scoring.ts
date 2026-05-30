import type { OpportunityScore, ScoreLevel, TrendSnapshotItem } from "./models.js";

const RELEVANCE_TERMS = [
  "sverklo",
  "code intelligence",
  "codebase",
  "repo",
  "repository",
  "mcp",
  "memory",
  "agent",
  "coding agent",
  "developer",
  "local-first",
  "ai coding",
  "blast radius",
  "symbol graph",
];

const RISK_TERMS = [
  "controversy",
  "lawsuit",
  "harassment",
  "hate",
  "security breach",
  "private leak",
  "competitor drama",
  "cursor vs",
  "windsurf vs",
  "claude vs",
];

const UNRELATED_TERMS = ["sports", "celebrity", "recipe", "weather", "crypto pump", "giveaway"];

export function scoreValue(level: ScoreLevel): number {
  if (level === "high") return 3;
  if (level === "medium") return 2;
  return 1;
}

export function scoreLevelFromNumber(value: number): ScoreLevel {
  if (value >= 3) return "high";
  if (value >= 2) return "medium";
  return "low";
}

export function computeOpportunityScore(item: TrendSnapshotItem, now = new Date().toISOString()): OpportunityScore {
  const text = `${item.text} ${item.source_context}`.toLowerCase();
  const matches = RELEVANCE_TERMS.filter((term) => text.includes(term));
  const unrelated = UNRELATED_TERMS.some((term) => text.includes(term));
  const risky = RISK_TERMS.some((term) => text.includes(term));
  const ageHours = item.observed_at ? Math.max(0, Date.parse(now) - Date.parse(item.observed_at)) / 36e5 : 24;

  const sverkloRelevance = unrelated ? "low" : scoreLevelFromNumber(matches.length >= 3 ? 3 : matches.length >= 1 ? 2 : 1);
  const audienceFit = unrelated ? "low" : scoreLevelFromNumber(matches.some((term) => term.includes("developer") || term.includes("code")) ? 3 : matches.length ? 2 : 1);
  const urgency = scoreLevelFromNumber(ageHours <= 24 ? 3 : ageHours <= 168 ? 2 : 1);
  const novelty = scoreLevelFromNumber(text.includes("new") || text.includes("launch") || text.includes("release") ? 3 : 2);
  const credibilityImpact = scoreLevelFromNumber(matches.some((term) => term.includes("local") || term.includes("memory") || term.includes("mcp")) ? 3 : matches.length ? 2 : 1);
  const brandSafetyRisk: ScoreLevel = risky ? "high" : text.includes("competitor") ? "medium" : "low";

  const positive =
    scoreValue(audienceFit) +
    scoreValue(sverkloRelevance) +
    scoreValue(urgency) +
    scoreValue(novelty) +
    scoreValue(credibilityImpact);
  const riskPenalty = brandSafetyRisk === "high" ? 25 : brandSafetyRisk === "medium" ? 10 : 0;
  const total = Math.max(0, Math.min(100, Math.round((positive / 15) * 100 - riskPenalty)));
  const reasons = [
    `${sverkloRelevance} Sverklo relevance`,
    `${audienceFit} audience fit`,
    `${urgency} timing urgency`,
    `${brandSafetyRisk} brand-safety risk`,
  ];

  return {
    audience_fit: audienceFit,
    sverklo_relevance: sverkloRelevance,
    urgency,
    novelty,
    credibility_impact: credibilityImpact,
    brand_safety_risk: brandSafetyRisk,
    total,
    reasons,
  };
}

export function opportunityTopic(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 8)
    .join(" ");
}

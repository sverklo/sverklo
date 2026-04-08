// Weighted risk score for changed files in a diff.
//
// Inspired by code-review-graph's compute_risk_score, adapted for sverklo's
// data model. Score is in [0, 1] — higher means "review more carefully".
// The formula is intentionally simple, deterministic, and explainable so a
// reviewer can see why a file got flagged.
//
//   untested            +0.30   no test file matches by name or import
//   security keywords   +0.20   path or symbol matches sensitive surface
//   high fan-in         up to +0.15   importer count / 20, capped
//   many callers        up to +0.10   total caller count of changed symbols / 100
//   dangling removes    up to +0.20   removed symbols still referenced
//   churn               up to +0.05   ln(added+removed) / 20, capped
//
// Total is clamped to 1.0. The breakdown is returned alongside the score so
// the reviewer can see the contributing reasons.

export interface RiskBreakdown {
  untested: number;
  security: number;
  fanIn: number;
  callers: number;
  dangling: number;
  churn: number;
}

export interface RiskScore {
  total: number;
  level: "low" | "medium" | "high" | "critical";
  breakdown: RiskBreakdown;
  reasons: string[];
}

export interface RiskInputs {
  path: string;
  added: number;
  removed: number;
  isTested: boolean;
  importerCount: number;
  changedSymbolNames: string[];
  totalCallerCount: number;
  danglingSymbolCount: number;
}

// Path/symbol substrings that indicate security-sensitive surface area.
// Lowercased before matching. Kept short on purpose — false positives here
// just nudge a reviewer to look more carefully, which is the right default.
const SECURITY_KEYWORDS = [
  "auth",
  "login",
  "logout",
  "session",
  "token",
  "jwt",
  "oauth",
  "password",
  "passwd",
  "secret",
  "credential",
  "crypto",
  "encrypt",
  "decrypt",
  "signature",
  "permission",
  "authorize",
  "authoriz",
  "access",
  "admin",
  "csrf",
  "xss",
  "sanitize",
  "sql",
  "query",
  "exec",
  "shell",
  "subprocess",
  "eval",
  "deserialize",
  "unmarshal",
  "pii",
  "billing",
  "payment",
  "stripe",
  "webhook",
];

function hasSecurityKeyword(haystack: string): boolean {
  const lower = haystack.toLowerCase();
  return SECURITY_KEYWORDS.some((kw) => lower.includes(kw));
}

export function computeRiskScore(inputs: RiskInputs): RiskScore {
  const breakdown: RiskBreakdown = {
    untested: 0,
    security: 0,
    fanIn: 0,
    callers: 0,
    dangling: 0,
    churn: 0,
  };
  const reasons: string[] = [];

  if (!inputs.isTested) {
    breakdown.untested = 0.3;
    reasons.push("no matching tests");
  }

  // Security: check path + symbol names
  const securityHaystack = [inputs.path, ...inputs.changedSymbolNames].join(" ");
  if (hasSecurityKeyword(securityHaystack)) {
    breakdown.security = 0.2;
    reasons.push("touches security-sensitive surface");
  }

  // File fan-in (importers): each importer worth 0.0075, capped 0.15
  if (inputs.importerCount > 0) {
    breakdown.fanIn = Math.min(0.15, inputs.importerCount * 0.0075);
    if (inputs.importerCount >= 5) {
      reasons.push(`${inputs.importerCount} importers depend on this file`);
    }
  }

  // Caller count of changed symbols: 0.001 per caller, capped 0.10
  if (inputs.totalCallerCount > 0) {
    breakdown.callers = Math.min(0.1, inputs.totalCallerCount * 0.001);
    if (inputs.totalCallerCount >= 20) {
      reasons.push(`${inputs.totalCallerCount} callers reference changed symbols`);
    }
  }

  // Dangling references on removed symbols are the most dangerous signal:
  // each removed symbol that still has callers is a near-certain breakage.
  if (inputs.danglingSymbolCount > 0) {
    breakdown.dangling = Math.min(0.2, inputs.danglingSymbolCount * 0.1);
    reasons.push(
      `${inputs.danglingSymbolCount} removed symbol${
        inputs.danglingSymbolCount === 1 ? "" : "s"
      } still referenced`
    );
  }

  // Churn: log-scaled so a 5-line edit isn't penalised but a 500-line one is
  const churnLines = inputs.added + inputs.removed;
  if (churnLines > 0) {
    breakdown.churn = Math.min(0.05, Math.log(1 + churnLines) / 100);
    if (churnLines >= 200) {
      reasons.push(`${churnLines} lines churned`);
    }
  }

  const total = Math.min(
    1,
    breakdown.untested +
      breakdown.security +
      breakdown.fanIn +
      breakdown.callers +
      breakdown.dangling +
      breakdown.churn
  );

  let level: RiskScore["level"];
  if (total >= 0.7) level = "critical";
  else if (total >= 0.45) level = "high";
  else if (total >= 0.2) level = "medium";
  else level = "low";

  return { total, level, breakdown, reasons };
}

export function formatRiskBadge(score: RiskScore): string {
  const pct = Math.round(score.total * 100);
  const icon =
    score.level === "critical"
      ? "🔴"
      : score.level === "high"
        ? "🟠"
        : score.level === "medium"
          ? "🟡"
          : "🟢";
  return `${icon} risk ${pct} (${score.level})`;
}

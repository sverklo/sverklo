export type EnoughnessConfidence = "high" | "medium" | "low";

export interface EnoughnessOptions {
  kind: "lookup" | "search";
  subject?: string;
  shown: number;
  total: number;
  locationOnly?: number;
  tokenBudget?: number;
  totalNeeded?: number;
  confidence?: EnoughnessConfidence;
  refsChecked?: boolean;
  testsChecked?: boolean;
}

function formatCoverage(opts: EnoughnessOptions): string {
  const locationOnly = opts.locationOnly ?? 0;
  const bodyShown = Math.max(0, opts.shown - locationOnly);
  const hidden = Math.max(0, opts.total - opts.shown);

  const parts: string[] = [];
  if (bodyShown > 0) {
    parts.push(`${bodyShown} bod${bodyShown === 1 ? "y" : "ies"} shown`);
  }
  if (locationOnly > 0) {
    parts.push(`${locationOnly} location-only`);
  }
  if (hidden > 0) {
    parts.push(`${hidden} hidden by budget`);
  }
  parts.push(`${opts.total} total`);
  return parts.join(", ");
}

function formatBudget(opts: EnoughnessOptions): string {
  if (opts.tokenBudget === undefined) return "budget: unknown";
  if (opts.totalNeeded && opts.totalNeeded > opts.tokenBudget) {
    return `budget: partial (token_budget=${opts.tokenBudget}; ~${opts.totalNeeded} for all)`;
  }
  return `budget: covered within token_budget=${opts.tokenBudget}`;
}

function formatNextStep(opts: EnoughnessOptions): string {
  if (opts.kind === "lookup") {
    const refs = opts.subject ? ` Run \`refs symbol:"${opts.subject}"\` before editing.` : "";
    return `Stop if you only needed the definition.${refs} Run \`test_map\` after a diff to verify likely tests.`;
  }

  return "Stop if the top hit answers the question; otherwise narrow the query/scope or raise token_budget.";
}

export function formatEnoughness(opts: EnoughnessOptions): string {
  const label = opts.kind === "lookup" ? "symbol found" : "matches found";
  const found = opts.total > 0 ? "yes" : "no";
  const refs = opts.refsChecked ? "yes" : "no";
  const tests = opts.testsChecked ? "checked" : "not checked";
  const confidence = opts.confidence ?? (opts.total > 0 ? "medium" : "low");

  return (
    `_Enoughness: ${label}: ${found} (${formatCoverage(opts)}); ` +
    `refs checked: ${refs}; likely test surface: ${tests}; confidence: ${confidence}; ` +
    `${formatBudget(opts)}. ${formatNextStep(opts)}_`
  );
}

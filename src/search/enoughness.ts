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

interface BudgetRequest {
  needsMoreBudget: boolean;
  proofGap: string;
  boundedNextCall: string;
  suggestedBudget?: number;
  approval: "harness_required" | "not_requested";
  onReject: string;
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

function buildBudgetRequest(opts: EnoughnessOptions): BudgetRequest {
  const needsMoreBudget =
    opts.tokenBudget !== undefined &&
    opts.totalNeeded !== undefined &&
    opts.totalNeeded > opts.tokenBudget;

  if (needsMoreBudget) {
    const suggestedBudget = opts.totalNeeded!;
    const subject =
      opts.subject && opts.subject.trim().length > 0
        ? ` ${opts.kind === "lookup" ? "symbol" : "query"}:"${opts.subject}"`
        : "";
    return {
      needsMoreBudget: true,
      proofGap: "hidden_by_budget",
      boundedNextCall: `${opts.kind}${subject} token_budget:${suggestedBudget}`,
      suggestedBudget,
      approval: "harness_required",
      onReject:
        "log budget_request_rejected with proof_gap, bounded_next_call, and rejection_reason",
    };
  }

  if (opts.total === 0) {
    return {
      needsMoreBudget: false,
      proofGap: "no_matches",
      boundedNextCall:
        opts.kind === "lookup"
          ? "check the symbol name or search by related terms"
          : "refine the query/scope or use exact string search",
      approval: "not_requested",
      onReject: "n/a",
    };
  }

  if (opts.kind === "lookup") {
    const subject = opts.subject ? ` symbol:"${opts.subject}"` : "";
    return {
      needsMoreBudget: false,
      proofGap: "refs_or_test_surface_not_checked",
      boundedNextCall: `refs${subject} before editing then test_map after a diff`,
      approval: "not_requested",
      onReject: "n/a",
    };
  }

  const confidence = opts.confidence ?? "medium";
  return {
    needsMoreBudget: false,
    proofGap: confidence === "high" ? "none" : "ranking_uncertain",
    boundedNextCall:
      confidence === "high"
        ? "stop if answered; otherwise refine query/scope"
        : "read top hits or refine query/scope",
    approval: "not_requested",
    onReject: "n/a",
  };
}

function formatBudgetRequest(opts: EnoughnessOptions): string {
  const request = buildBudgetRequest(opts);
  const fields = [
    `needs_more_budget=${request.needsMoreBudget ? "true" : "false"}`,
    `proof_gap=${request.proofGap}`,
    `bounded_next_call=${request.boundedNextCall}`,
  ];
  if (request.suggestedBudget !== undefined) {
    fields.push(`suggested_budget=${request.suggestedBudget}`);
  }
  fields.push(`approval=${request.approval}`);
  fields.push(`on_reject=${request.onReject}`);
  return `budget request: ${fields.join("; ")}`;
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
    `${formatBudget(opts)}; ${formatBudgetRequest(opts)}. ${formatNextStep(opts)}_`
  );
}

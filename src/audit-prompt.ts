// Ready-to-paste audit prompt template for AI coding agents.
//
// The goal of this template is to encode the hybrid workflow that
// consistently produces the best results across repo sizes:
//
//   • prefer sverklo tools for discovery, reference-checking, and
//     structural/dependency analysis
//   • fall back to built-in Grep/Read/Bash for exact patterns,
//     line-level inspection, and quantitative sweeps
//
// Surfaced via `sverklo audit-prompt` so users can paste it straight
// into Claude Code, Cursor, Windsurf, or any other MCP-speaking agent.

export type AuditPromptMode = "audit" | "review";

export function renderAuditPrompt(mode: AuditPromptMode = "audit"): string {
  if (mode === "review") return REVIEW_PROMPT;
  return AUDIT_PROMPT;
}

const AUDIT_PROMPT = `Audit this codebase for real, actionable issues. Goal: 8–12 concrete findings, each with file path, line number, severity (high/medium/low), and a one-sentence fix.

Follow the hybrid workflow — prefer sverklo tools where they're the sharpest instrument, fall back to built-in tools where they are:

## Phase 1 — Discovery (prefer sverklo)

1. \`sverklo_overview\` — structural map of the codebase, ranked by importance. Identify hub files and large files first.
2. \`sverklo_audit\` — one-call pass for god nodes, hub files, and dead-code candidates. Treat this as your seed list.
3. \`sverklo_search\` — semantic queries for anti-patterns you can describe in English but not regex cleanly (e.g. "swallowed exceptions", "silent failure returning null", "unsafe narrowing cast").

## Phase 2 — Verify dead code and usage (sverklo wins here)

4. \`sverklo_refs <symbol>\` — prove a method, class, or constant really has zero callers before you delete it. Grep can't match this with certainty because it misses reflective/string-based calls that the symbol graph catches.
5. \`sverklo_deps <file>\` — map the dependency fan-in of suspicious hub files.

## Phase 3 — Exact patterns (built-in wins here)

6. \`Grep\` for concrete syntactic smells:
   - empty catches: \`catch\\s*\\([^)]*\\)\\s*\\{[\\s]*\\}\`
   - unlogged catches returning null/default: \`catch.*\\{[^}]*return (null|false|0|"")\`
   - hardcoded credentials: \`password|secret|api[_-]?key|token\`
   - TODOs/FIXMEs that have rotted: \`TODO|FIXME|HACK|XXX\`
   - debug leakage: \`System\\.out\\.print|console\\.log|printStackTrace\`
7. \`Bash\` for quantitative sweeps: line counts per file (find the 1,000+-line classes), catch-block counts per file, wildcard import counts.

## Phase 4 — Read carefully (built-in wins here)

8. \`Read\` each candidate file in full. Semantic search surfaces candidates; line-level issues (off-by-one, wrong log constant, stream pipelines that need try-catch) only show up under careful human/agent reading.

## Rules

- Every finding gets: file path, line numbers, severity, one-sentence fix.
- Don't report style nits. Report things that would hurt in production.
- If a finding relies on "this symbol is unused", verify with \`sverklo_refs\` before reporting it.
- If a finding relies on "this pattern appears N times", verify with \`Grep\` count before reporting it.
- Stop at 8–12 findings. More than that is noise.

Now begin. Share the finding list at the end as a single Markdown table.
`;

const REVIEW_PROMPT = `Review this pull request / merge request for real risks. Goal: an approve/request-changes recommendation with 3–6 specific comments.

Follow the hybrid workflow:

## Phase 1 — Understand the diff

1. \`git diff <base>...HEAD --stat\` and \`git log --oneline <base>...HEAD\` — structural shape of the change.
2. \`sverklo_review_diff\` — risk-scored review order. Read the highest-risk files first.
3. \`sverklo_diff_search\` — semantic search scoped to the changed surface.

## Phase 2 — Blast radius (sverklo wins here)

4. For each modified symbol, \`sverklo_refs <symbol>\` and \`sverklo_impact <symbol>\` to see who depends on it. Flag silent behavior changes on high-fan-in symbols.
5. \`sverklo_test_map\` — which tests cover the changed symbols? Flag modified production code with no test changes.

## Phase 3 — Read the changed files line by line (built-in wins here)

6. \`Read\` each changed file in full. Look specifically for:
   - new calls inside stream pipelines / \`.map()\` / \`.forEach()\` that can throw and aren't wrapped in try-catch — one uncaught \`RuntimeException\` can break the entire read path
   - new \`catch\` blocks that swallow exceptions silently
   - narrowing casts (\`(int) someLong\`, \`\`as number\`\`) introduced by the diff
   - logging added at \`info\` that should be \`error\`, or vice versa
   - any new \`parallelStream()\` or goroutines inside a transactional / single-connection scope
7. \`Grep\` for copy-paste patterns introduced by the diff (look for the new feature's identifier; if it already appears elsewhere, you may have a duplicated helper).

## Rules

- Be specific: quote the file and line, not "somewhere in the diff".
- Prefer structural risks (blast radius, swallowed failures, concurrency) over style.
- If you approve, say what the strongest part of the change is.
- If you request changes, rank them: must-fix vs nice-to-have.

Deliver the review as: verdict, strongest-part, must-fix list, nice-to-have list.
`;

// MCP prompt templates exposed via prompts/list and prompts/get.
//
// Prompts show up in IDE pickers (Claude Code, Cursor, Antigravity) as
// reusable workflows. Sverklo's value lives mostly in tool composition, so
// these templates encode the *order* of tool calls a user should make for
// common code-intelligence tasks. Each prompt accepts a small number of
// arguments and returns a single user-role message that the host model can
// then act on with sverklo's tools available.

export interface PromptArgument {
  name: string;
  description: string;
  required?: boolean;
}

export interface PromptDefinition {
  name: string;
  description: string;
  arguments: PromptArgument[];
  /**
   * Build the prompt body. Receives the raw arguments object from the MCP
   * client; missing optional args are undefined.
   */
  build: (args: Record<string, string | undefined>) => string;
}

const REVIEW_CHANGES: PromptDefinition = {
  name: "sverklo/review-changes",
  description:
    "Diff-aware code review workflow. Walks the model through sverklo's diff tools to surface blast radius, dangling references, missing tests, and risk-scored hotspots.",
  arguments: [
    {
      name: "ref",
      description: "Git ref or range to review (default: main..HEAD)",
      required: false,
    },
  ],
  build: ({ ref }) => {
    const r = ref || "main..HEAD";
    return `You are reviewing the diff \`${r}\`. Use sverklo's diff-aware tools, in order:

1. Call \`sverklo_review_diff\` with \`ref:"${r}"\` to get the changed files, semantic delta (added/removed/modified symbols), dangling references for removed symbols, importer counts, and a per-file risk score. Read the **Highest-risk files** section first.
2. Call \`sverklo_test_map\` with \`ref:"${r}"\` to see which tests cover the changes and which changed files have no matching tests. Prioritise the risk-ranked uncovered list.
3. For any removed symbol with dangling references, call \`sverklo_impact symbol:"<name>"\` to enumerate every caller — these are likely breakages.
4. For any added symbol that looks like it duplicates existing functionality, call \`sverklo_lookup\` to find the existing definition.
5. Only after the above, read the actual diff with \`git diff ${r}\` for the highest-risk file(s).

Constraint: keep the total number of tool calls under 8. Do not grep for things sverklo can answer structurally. Do not paraphrase the tool output back at the user — synthesise the review. End with a clear verdict (LGTM / request changes / blocking concern) and a bulleted list of must-fix items, each tied to a file:line.`;
  },
};

const PRE_MERGE_CHECK: PromptDefinition = {
  name: "sverklo/pre-merge",
  description:
    "Final pre-merge sanity check. Stricter than review-changes — looks for unsafe removals, untested security-sensitive changes, and high-fan-in modifications.",
  arguments: [
    {
      name: "ref",
      description: "Git ref or range about to be merged (default: main..HEAD)",
      required: false,
    },
  ],
  build: ({ ref }) => {
    const r = ref || "main..HEAD";
    return `You are the last reviewer before merging \`${r}\`. Be strict.

1. Call \`sverklo_review_diff ref:"${r}"\`. The response includes a per-file risk score. **Block the merge** if any file is risk level "critical" without an explicit reason in the PR description.
2. Call \`sverklo_test_map ref:"${r}"\`. **Block the merge** if any uncovered file has risk level "high" or "critical" — require tests or an explicit waiver.
3. For every removed symbol with dangling references, call \`sverklo_impact\` and verify each caller has been updated in the same diff. A dangling reference is a hard block.
4. Call \`sverklo_recall query:"<area being changed>"\` to surface any prior decisions or invariants that this change might violate.

Output a structured verdict:
- **Status:** APPROVED / BLOCKED / NEEDS CLARIFICATION
- **Blocking issues:** (file:line + reason)
- **Non-blocking concerns:** (file:line + reason)
- **Suggested follow-ups:** (memories to save with sverklo_remember, or tests to add)

Do not approve without justification for every "high" or "critical" risk file.`;
  },
};

const ONBOARD: PromptDefinition = {
  name: "sverklo/onboard",
  description:
    "New-developer onboarding tour. Builds a mental model of the codebase using sverklo_overview, top-PageRank files, and core memories.",
  arguments: [
    {
      name: "focus",
      description: "Optional area to focus on (e.g. 'auth', 'billing', 'data pipeline')",
      required: false,
    },
  ],
  build: ({ focus }) => {
    const focusLine = focus
      ? `The new developer is specifically interested in: **${focus}**. Tailor the tour to that area.`
      : "Give a generalist tour suitable for any new contributor.";
    return `Help a new developer get oriented in this codebase. ${focusLine}

1. Call \`sverklo_overview\` to get the high-level structure: top languages, top-PageRank files, module map.
2. Call \`sverklo_recall query:"architecture"\` and \`sverklo_recall query:"conventions"\` to surface any saved invariants and design decisions.
3. ${focus ? `Call \`sverklo_search query:"${focus}"\` to find the entry points for the focus area.` : "Pick 2-3 of the highest-PageRank source files and call `sverklo_lookup` on their main exported symbols to show what they do."}
4. For the most central file you find, call \`sverklo_deps\` to show its place in the import graph.

Then write a concise onboarding doc (under 600 words) with:
- "Start here" — the 3-5 files to read first, in order, with a one-line reason for each
- "Key abstractions" — the named concepts a new dev needs to understand
- "Conventions" — anything from recall that affects how to write code in this repo
- "Where to look for X" — a short index mapping common tasks to relevant directories

Do not invent facts. If sverklo doesn't surface something, say so.`;
  },
};

const ARCHITECTURE_MAP: PromptDefinition = {
  name: "sverklo/architecture-map",
  description:
    "Generate an architecture map of the codebase using sverklo's overview, dependency graph, and PageRank-ranked centrality.",
  arguments: [],
  build: () => `Produce an architecture map of this codebase using only sverklo tools.

1. Call \`sverklo_overview\` for the structural summary (file/chunk/language counts, top-PageRank files).
2. For each of the top 5 PageRank files, call \`sverklo_deps\` to see what depends on it and what it depends on. These are the load-bearing modules.
3. Call \`sverklo_recall query:"architecture"\` for any saved design decisions.
4. Call \`sverklo_search query:"entry point main bootstrap"\` to find the application entry points.

Produce an architecture map with:
- **Entry points** — where execution starts
- **Core modules** — the high-PageRank files that everything else hangs off, with a one-line role for each
- **Layering** — what depends on what (group by module, not file)
- **Cross-cutting concerns** — anything that shows up in many unrelated places (logging, auth, config)
- **Risks** — high-fan-in files with no tests, circular dependencies, or anything recall flagged as fragile

Use only what sverklo returns. Do not invent module names.`,
};

const DEBUG_ISSUE: PromptDefinition = {
  name: "sverklo/debug-issue",
  description:
    "Bug-hunt workflow. Uses semantic search, references, and saved memories to localise an issue without grepping the whole repo.",
  arguments: [
    {
      name: "symptom",
      description: "Short description of the bug or symptom (e.g. 'login returns 500 for OAuth users')",
      required: true,
    },
  ],
  build: ({ symptom }) => {
    return `Help debug this issue: **${symptom || "(unspecified — ask the user for the symptom first)"}**

1. Call \`sverklo_recall query:"${symptom}"\` — there may be a prior decision or known-issue memory that explains this.
2. Call \`sverklo_search query:"${symptom}"\` to find the most semantically relevant code regions. Read the top 3 results.
3. From those results, identify the 1-2 most likely entry points or error sources. Call \`sverklo_refs symbol:"<name>"\` on each to see who calls them — the bug may be in a caller, not the function itself.
4. If the symptom mentions a specific error message, call \`sverklo_search query:"<error string>"\` to find where it's thrown.
5. Call \`sverklo_deps file:"<suspect file>"\` to see what the suspect code depends on — the bug may be in a dependency.

Then produce:
- **Most likely root cause:** (file:line + one-paragraph explanation)
- **Other candidates:** (ranked, with reasoning)
- **What to verify:** specific assertions or test inputs that would confirm/deny each hypothesis
- **Suggested fix:** only if the root cause is clear

Do not propose code changes without identifying a specific file:line. If the search turns up nothing relevant, say so and ask the user for more context (stack trace, repro steps).`;
  },
};

// ── Research recipes (v0.14, P1-16). Leverage sverklo_investigate +
// sverklo_verify so answers stay grounded in evidence the user can audit.

const MAP_FEATURE: PromptDefinition = {
  name: "sverklo/map-feature",
  description:
    "Map a feature across the codebase: entry points, key symbols, tests, and docs. " +
    "Uses sverklo_investigate to fan-out over FTS + vector + symbol + refs in one call.",
  arguments: [
    {
      name: "feature",
      description:
        "The feature to map, in a short phrase — 'pull request review', 'auth middleware', 'token budgeting'.",
      required: true,
    },
    {
      name: "scope",
      description: "Optional path prefix to limit the search, e.g. 'src/server/'.",
      required: false,
    },
  ],
  build: ({ feature, scope }) => {
    const scopeArg = scope ? `, scope:"${scope}"` : "";
    return `Map the \`${feature}\` feature across the codebase. Use sverklo's research tools in this order:

1. Call \`sverklo_investigate query:"${feature}"${scopeArg}\` for a single-pass fan-out over FTS, embeddings, symbols, and refs. Read the \`found_by\` tags — results agreed on by multiple retrievers are higher-signal than single-source hits.
2. Pick the top 3-5 symbols from the investigation and call \`sverklo_refs\` on each to expand the surface area. Note any **Doc mentions** sections — they tell you where the feature is documented.
3. For the two most-referenced symbols, call \`sverklo_impact\` to see blast radius before proposing any changes. If partition plans appear, pick one bucket and drill in rather than reading the full list.
4. Call \`sverklo_test_map\` scoped to the same directories — which tests cover this feature?
5. Summarise in this structure:
   - **Entry points:** 1-3 files where the feature is first reached
   - **Core symbols:** classes/functions that implement it
   - **Supporting modules:** everything one hop away
   - **Tests:** files that exercise it
   - **Docs:** README / ADR sections that describe it
   - **Open questions:** things sverklo's retrievers couldn't pin down

End with a list of evidence ids (from the \`evidence\` footers) the user can \`sverklo_verify\` if they want to audit your map.`;
  },
};

const ASSESS_IMPACT: PromptDefinition = {
  name: "sverklo/assess-impact",
  description:
    "Before a refactor: enumerate the blast radius of changing a symbol, group by subsystem, " +
    "call out weak spots (uncovered callers, cross-repo contracts), and produce a go/no-go.",
  arguments: [
    { name: "symbol", description: "The symbol about to be changed.", required: true },
    {
      name: "change",
      description: "One-line description of the proposed change (optional but useful).",
      required: false,
    },
  ],
  build: ({ symbol, change }) => {
    const changeLine = change
      ? `\nProposed change: ${change}\n`
      : "";
    return `Assess the impact of changing \`${symbol}\`.${changeLine}
Run these steps, in order:

1. \`sverklo_lookup symbol:"${symbol}"\` — confirm exactly one definition exists. If there are multiple, pin down which one the change targets before proceeding.
2. \`sverklo_impact symbol:"${symbol}"\` — full caller graph. If the result returns a partition plan (> 80 callers), traverse one bucket at a time rather than reading the raw list.
3. \`sverklo_test_map symbol:"${symbol}"\` — which tests exercise the callers? Callers with zero test coverage are the highest-risk items.
4. \`sverklo_refs symbol:"${symbol}"\` with \`exact:true\` — confirms we haven't missed documentation mentions. If any **Doc mentions** show up, flag them as places the change should also update the docs.
5. If \`cross_repo:true\` is available (workspace configured), re-run \`sverklo_impact symbol:"${symbol}" cross_repo:true\` — cross-repo contracts are the most expensive category of breakage.

Deliver a decision memo:
- **Risk level:** LOW / MEDIUM / HIGH (justify in one sentence)
- **Callers by subsystem:** grouped list, highest fan-in first
- **Uncovered callers:** specific file:line with no tests
- **Doc updates required:** if any doc mentions exist
- **Cross-repo touches:** if any
- **Go / no-go:** with a one-line rationale

Attach the evidence ids for every claim so the user can \`sverklo_verify\` your analysis didn't go stale between reading and acting.`;
  },
};

export const ALL_PROMPTS: PromptDefinition[] = [
  REVIEW_CHANGES,
  PRE_MERGE_CHECK,
  ONBOARD,
  ARCHITECTURE_MAP,
  DEBUG_ISSUE,
  MAP_FEATURE,
  ASSESS_IMPACT,
];

export function findPrompt(name: string): PromptDefinition | undefined {
  return ALL_PROMPTS.find((p) => p.name === name);
}

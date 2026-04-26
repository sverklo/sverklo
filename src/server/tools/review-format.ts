// Sprint 9 follow-up: emit a structured GitHub-PR-Review JSON payload
// alongside the existing markdown sticky comment. The action.yml step
// can POST this directly to `pulls.createReview` to drop inline review
// comments anchored to the lines our heuristics flagged.
//
// The schema is intentionally minimal — only what the GitHub API
// accepts, plus enough metadata for action.yml to decide whether to
// fail the build:
//
//   {
//     "ref":            "main..HEAD",
//     "max_risk":       "high",
//     "summary":        "<markdown body for the sticky comment>",
//     "inline":         [ { path, line, severity, body }, ... ],
//     "high_risk_files": [ { path, score, reasons } ]
//   }

import { spawnSync } from "node:child_process";
import type { Indexer } from "../../indexer/indexer.js";
import {
  getDiffHunks,
  runAllHeuristics,
  type HeuristicFinding,
} from "./diff-heuristics.js";
import { handleReviewDiff } from "./review-diff.js";
import { validateGitRef } from "../../utils/git-validation.js";

export type RiskLevel = "critical" | "high" | "medium" | "low";

export interface InlineComment {
  /** Repo-relative path of the file being commented on. */
  path: string;
  /** 1-based file line number. GitHub accepts `line` directly since 2022. */
  line: number;
  /** GitHub PR review API value (`RIGHT` for additions, `LEFT` for deletions). */
  side: "RIGHT" | "LEFT";
  severity: HeuristicFinding["severity"];
  /** Markdown body for the inline comment (may include a `suggestion` block). */
  body: string;
}

export interface ReviewJson {
  ref: string;
  max_risk: RiskLevel;
  summary: string;
  inline: InlineComment[];
  /** Files the markdown summary already calls out as high-risk; pre-deduped. */
  high_risk_files: { path: string; severity: HeuristicFinding["severity"] }[];
}

const SEVERITY_ORDER: Record<RiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function deriveMaxRisk(summary: string, findings: HeuristicFinding[]): RiskLevel {
  let max: RiskLevel = "low";
  for (const level of ["critical", "high", "medium", "low"] as RiskLevel[]) {
    if (summary.includes(`(${level})`)) {
      if (SEVERITY_ORDER[level] > SEVERITY_ORDER[max]) max = level;
    }
  }
  for (const f of findings) {
    const lvl = f.severity as RiskLevel;
    if (SEVERITY_ORDER[lvl] > SEVERITY_ORDER[max]) max = lvl;
  }
  return max;
}

/**
 * Same input shape as `handleReviewDiff` (`{ ref, max_files, ... }`); same
 * git-diff + heuristic pipeline. Different rendering: a JSON payload the
 * GitHub Action can hand to `pulls.createReview` to post inline comments.
 */
export function buildReviewJson(
  indexer: Indexer,
  args: Record<string, unknown>
): ReviewJson | { error: string } {
  const ref = (args.ref as string) || "main..HEAD";
  if (!validateGitRef(ref)) {
    return { error: "invalid git ref" };
  }

  // Reuse the existing markdown handler for the sticky-comment body —
  // it already encodes risk-scored files, dangling refs, similar-symbol
  // detection, all the things the human reviewer wants in one place.
  const summary = handleReviewDiff(indexer, args);
  if (summary.startsWith("Error:")) {
    return { error: summary.slice(7).trim() };
  }

  // Run heuristics from the SAME diff. These give us the per-line
  // anchors that the markdown summary intentionally elides (since
  // markdown comments don't anchor to lines). Inline review comments
  // are where heuristics live their best life.
  const hunks = getDiffHunks(indexer.rootPath, ref);
  const findings = runAllHeuristics(hunks);

  const inline: InlineComment[] = findings.map((f) => ({
    path: f.file,
    line: f.line,
    side: "RIGHT", // heuristics fire on additions
    severity: f.severity,
    body: renderInlineBody(f),
  }));

  const high_risk_files = inline
    .filter((c) => c.severity !== "low")
    .map((c) => ({ path: c.path, severity: c.severity }))
    // dedup by path: only the highest severity per file in this list
    .reduce<{ path: string; severity: HeuristicFinding["severity"] }[]>(
      (acc, cur) => {
        const existing = acc.find((e) => e.path === cur.path);
        if (!existing) {
          acc.push(cur);
        } else if (
          SEVERITY_ORDER[cur.severity as RiskLevel] >
          SEVERITY_ORDER[existing.severity as RiskLevel]
        ) {
          existing.severity = cur.severity;
        }
        return acc;
      },
      []
    );

  return {
    ref,
    max_risk: deriveMaxRisk(summary, findings),
    summary,
    inline,
    high_risk_files,
  };
}

function renderInlineBody(f: HeuristicFinding): string {
  const sevBadge =
    f.severity === "high"
      ? "🔴 **risk: high**"
      : f.severity === "medium"
      ? "🟠 **risk: medium**"
      : "🟡 **risk: low**";
  const lines = [
    `${sevBadge} · \`${f.heuristic}\``,
    "",
    f.message,
  ];
  if (f.snippet) {
    lines.push("", "```", f.snippet, "```");
  }
  lines.push(
    "",
    "_Posted by [sverklo](https://sverklo.com) — local-first code intelligence_"
  );
  return lines.join("\n");
}

/** Confirms the diff command works in the given repo. Used for smoke tests. */
export function diffCommandWorks(rootPath: string, ref: string): boolean {
  if (!validateGitRef(ref)) return false;
  const r = spawnSync("git", ["diff", "--name-only", ref], {
    cwd: rootPath,
    encoding: "utf-8",
    timeout: 5000,
  });
  return r.status === 0;
}

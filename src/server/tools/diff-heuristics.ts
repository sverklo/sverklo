// Structural heuristics that scan the actual diff text for specific classes
// of risk that symbol-level analysis alone will not catch. Kept as a
// separate module so new heuristics can be added without touching the
// main review-diff handler, and so each heuristic is unit-testable in
// isolation.
//
// Heuristics are *heuristics* — they trade some false positives for
// recall on real-world bugs. Each one attaches a short "why" so a human
// reviewer can quickly dismiss a false flag.
//
// Current heuristics:
//   - unguarded-stream-call: a new call site introduced inside a stream
//     pipeline (.map / .forEach / .flatMap / .filter / .reduce / etc.)
//     where the enclosing function has no visible try-catch. One
//     uncaught RuntimeException on a single element will abort the
//     entire stream — a real outage risk on production read paths.
//     Tracked in github.com/sverklo/sverklo/issues/5.
//
// Adding a heuristic:
//   1. Write a pure function that takes a DiffHunk[] and returns
//      HeuristicFinding[]. No I/O, no git, no filesystem — the caller
//      is responsible for producing hunks.
//   2. Register it in ALL_HEURISTICS below.
//   3. Unit-test it with representative fixtures.

import { spawnSync } from "node:child_process";
import { validateGitRef } from "../../utils/git-validation.js";

export interface DiffHunk {
  filePath: string;
  oldStart: number;
  newStart: number;
  /** Every line in the hunk, including context. Each entry is "+ ", "- ", " " followed by content. */
  lines: string[];
}

export interface HeuristicFinding {
  heuristic: string;
  severity: "high" | "medium" | "low";
  file: string;
  line: number;
  snippet: string;
  message: string;
}

// ────────────────────────────────────────────────────────────────────
// Heuristic 1 — unguarded stream-pipeline call
// ────────────────────────────────────────────────────────────────────

// Stream pipeline markers we care about. The list is deliberately
// multi-language: Java / TS / Kotlin / Scala all share the same shape.
const STREAM_METHODS = [
  "map",
  "forEach",
  "flatMap",
  "filter",
  "reduce",
  "mapToInt",
  "mapToLong",
  "mapToDouble",
  "peek",
  "collect",
];

// A line is "entering a stream pipeline" if it matches `.<method>(`
// where <method> is one of the above. We accept optional whitespace.
const STREAM_ENTRY_RE = new RegExp(
  `\\.(${STREAM_METHODS.join("|")})\\s*\\(`
);

// A line looks like a call that may throw if it contains `.<name>(`
// for an identifier-shaped name. This is broad on purpose — most method
// calls *can* throw, so any introduced call inside a stream pipeline
// without a try-catch is the pattern we want to flag.
const ANY_CALL_RE = /\b\w+\s*\(/;

// A try-catch is "visible" in the hunk if we see a `try` or `catch`
// token on any context line. This is a conservative proxy for "the
// enclosing method catches its exceptions" — an AST-based check would
// be more accurate but would require parsing the entire file per diff.
const TRY_OR_CATCH_RE = /\b(try|catch)\b/;

export function findUnguardedStreamCalls(hunks: DiffHunk[]): HeuristicFinding[] {
  const findings: HeuristicFinding[] = [];

  for (const hunk of hunks) {
    // Is there a visible try / catch anywhere in the hunk's context?
    // If so, skip the whole hunk — the enclosing method probably
    // catches. False negatives here are fine; we care about loud wins.
    const hasTryCatch = hunk.lines.some((l) => TRY_OR_CATCH_RE.test(l));
    if (hasTryCatch) continue;

    // Walk the hunk line by line. Track whether we've seen a stream
    // entry on a preceding context/added line, and whether we're still
    // "inside" it (approximated by nesting depth on the same or next
    // lines in the hunk).
    let insideStreamDepth = 0;
    let streamFileLine = hunk.newStart;
    let currentNewLine = hunk.newStart;

    for (const rawLine of hunk.lines) {
      const prefix = rawLine.charAt(0);
      const content = rawLine.slice(1);

      // Track whether we're in a stream block, using a crude brace count
      // scoped to the hunk. This misses pipelines that span more than the
      // hunk window — we accept that as a recall tradeoff.
      if (STREAM_ENTRY_RE.test(content)) {
        insideStreamDepth = 1;
        streamFileLine = currentNewLine;
      } else if (insideStreamDepth > 0) {
        const opens = (content.match(/\(/g) || []).length;
        const closes = (content.match(/\)/g) || []).length;
        insideStreamDepth += opens - closes;
        if (insideStreamDepth < 0) insideStreamDepth = 0;
      }

      // Only flag on added lines (new risks), not context. Context
      // lines merely help us track state.
      if (prefix === "+" && insideStreamDepth > 0 && ANY_CALL_RE.test(content)) {
        // Skip the stream-entry line itself — we only flag the *body*
        // calls inside the pipeline, not the pipeline declaration.
        if (!STREAM_ENTRY_RE.test(content)) {
          findings.push({
            heuristic: "unguarded-stream-call",
            severity: "medium",
            file: hunk.filePath,
            line: currentNewLine,
            snippet: content.trim().slice(0, 120),
            message:
              "New call inside a stream pipeline with no visible try-catch in the hunk. " +
              "A single RuntimeException on one element will abort the entire pipeline — " +
              "on a production read path this is an outage. Wrap the lambda body in " +
              "try-catch or pre-filter elements that could throw.",
          });
          // Flag once per stream block to avoid spamming — a block with
          // ten calls is one finding, not ten.
          insideStreamDepth = 0;
        }
      }

      // Advance the running new-file line counter. Context and added
      // lines both consume new-file line numbers; removed lines do not.
      if (prefix === "+" || prefix === " ") currentNewLine++;
    }
  }

  return findings;
}

// ────────────────────────────────────────────────────────────────────
// Registry + driver
// ────────────────────────────────────────────────────────────────────

export const ALL_HEURISTICS: ((hunks: DiffHunk[]) => HeuristicFinding[])[] = [
  findUnguardedStreamCalls,
];

export function runAllHeuristics(hunks: DiffHunk[]): HeuristicFinding[] {
  const all: HeuristicFinding[] = [];
  for (const fn of ALL_HEURISTICS) {
    try {
      all.push(...fn(hunks));
    } catch {
      // One broken heuristic must not take down review. Swallow and move on.
    }
  }
  return all;
}

// ────────────────────────────────────────────────────────────────────
// Parser — turn `git diff --unified=N` text into DiffHunk[]
// ────────────────────────────────────────────────────────────────────

/**
 * Parse a unified-diff string (output of `git diff -U5 ref`) into hunks.
 * Very permissive — anything that doesn't match the expected header is
 * skipped rather than raising.
 */
export function parseUnifiedDiff(diffText: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const lines = diffText.split("\n");

  let currentFile: string | null = null;
  let currentHunk: DiffHunk | null = null;

  for (const line of lines) {
    // New file header: "diff --git a/foo b/foo"
    if (line.startsWith("diff --git ")) {
      if (currentHunk) {
        hunks.push(currentHunk);
        currentHunk = null;
      }
      currentFile = null;
      continue;
    }

    // "+++ b/path" gives us the new file path
    if (line.startsWith("+++ ")) {
      const path = line.slice(4).replace(/^b\//, "").trim();
      currentFile = path === "/dev/null" ? null : path;
      continue;
    }

    // Hunk header: "@@ -12,5 +34,7 @@ optional-context"
    if (line.startsWith("@@ ")) {
      if (currentHunk) hunks.push(currentHunk);
      const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match && currentFile) {
        currentHunk = {
          filePath: currentFile,
          oldStart: parseInt(match[1], 10),
          newStart: parseInt(match[2], 10),
          lines: [],
        };
      } else {
        currentHunk = null;
      }
      continue;
    }

    // Body lines: "+", "-", or " " prefixed
    if (currentHunk && (line.startsWith("+") || line.startsWith("-") || line.startsWith(" "))) {
      // Skip the file-metadata lines "+++" / "---" which we already handled above
      if (line.startsWith("+++") || line.startsWith("---")) continue;
      currentHunk.lines.push(line);
    }
  }
  if (currentHunk) hunks.push(currentHunk);

  return hunks;
}

/**
 * Convenience: pull a unified diff from git and parse it.
 */
export function getDiffHunks(rootPath: string, ref: string): DiffHunk[] {
  if (!validateGitRef(ref)) return [];
  try {
    const result = spawnSync("git", ["diff", "--unified=10", ref], {
      cwd: rootPath,
      encoding: "utf-8",
      timeout: 8000,
      maxBuffer: 10 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || `git exited with ${result.status}`);
    return parseUnifiedDiff(result.stdout);
  } catch {
    return [];
  }
}

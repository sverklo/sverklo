// Scoring boosts borrowed from fff.nvim's score.rs (MIT). Each one is
// independent and small enough to ship behind a feature flag if needed.
// All three operate on top of the RRF-fused base score, multiplicatively.
//
// FOLLOW-UP (deferred): fff.nvim also has a "dual-decay frecency" model
// where AI sessions get a 3-day half-life and human sessions get 10-day
// (frecency.rs:21-45). Implementing it for Sverklo requires tracking
// per-(repo, file) access timestamps and a client-type signal through
// the MCP layer — not in scope for this patch. Tracked for v0.13.

import { basename, dirname, sep } from "node:path";

// Files that conventionally re-export a module's surface area or define
// its entry point. A small bonus disambiguates the common case of "I
// typed `foo` and there are 12 files containing `foo`; which one is the
// actual module entry?". Borrowed table from fff.nvim score.rs:745.
const ENTRY_POINT_BASENAMES = new Set([
  // JS / TS
  "index.ts",
  "index.tsx",
  "index.js",
  "index.jsx",
  "index.mjs",
  "index.cjs",
  // Python
  "__init__.py",
  "__main__.py",
  // Rust
  "mod.rs",
  "lib.rs",
  "main.rs",
  // Go
  "main.go",
  // C / C++
  "main.c",
  "main.cpp",
  "main.cc",
  // Java / Kotlin
  "Main.java",
  "Main.kt",
  // Ruby
  "main.rb",
]);

/**
 * +5% multiplicative bonus for files that conventionally serve as a
 * module's entry point. Cheap disambiguation for files-with-the-same-name
 * cases.
 */
export function entryPointBonus(filePath: string): number {
  return ENTRY_POINT_BASENAMES.has(basename(filePath)) ? 1.05 : 1.0;
}

/**
 * Path-suffix alignment. When the user typed a path-shaped query (one
 * containing a separator), files whose path *ends* with that fragment
 * are dramatically more likely to be the intended target. Score by the
 * number of matched trailing segments × per-segment weight.
 *
 * Returns a multiplicative factor in [1.0, 1.4]. No-op (1.0) for
 * non-path queries or when no suffix overlap exists.
 *
 * Borrowed shape from fff.nvim score.rs:677-700.
 */
export function pathSuffixAlignmentBonus(query: string, filePath: string): number {
  // Only kicks in for path-shaped queries.
  if (!query.includes("/") && !query.includes(sep)) return 1.0;

  // Normalize separators to forward-slash for comparison.
  const normalizedQuery = query.replaceAll("\\", "/").toLowerCase();
  const normalizedPath = filePath.replaceAll("\\", "/").toLowerCase();

  const querySegments = normalizedQuery.split("/").filter(Boolean);
  const pathSegments = normalizedPath.split("/").filter(Boolean);
  if (querySegments.length === 0 || pathSegments.length === 0) return 1.0;

  // Count contiguous matching segments from the right. The query's last
  // segment must exactly equal the path's last segment for a match to
  // start; partial filename matches are handled elsewhere.
  let matched = 0;
  for (let i = 1; i <= Math.min(querySegments.length, pathSegments.length); i++) {
    if (querySegments[querySegments.length - i] === pathSegments[pathSegments.length - i]) {
      matched++;
    } else {
      break;
    }
  }

  if (matched === 0) return 1.0;

  // Each matched segment adds 10%, capped at +40%.
  return 1.0 + Math.min(0.4, matched * 0.1);
}

/**
 * When the MCP caller provides the file the user is currently editing,
 * penalize candidates by directory distance. Files in the same dir or a
 * sibling are more relevant than something across the repo. Borrowed
 * from fff.nvim path_utils.rs:36-92.
 *
 * Returns a multiplicative factor in (0.5, 1.0]. No-op when currentFile
 * is undefined.
 *
 * The penalty is gentle because the structural signals (PageRank, RRF)
 * already do a lot of work — we only want to break ties between two
 * otherwise-equivalent candidates.
 */
export function currentFileDistancePenalty(
  candidatePath: string,
  currentFile: string | undefined
): number {
  if (!currentFile || candidatePath === currentFile) return 1.0;

  const candidateDirs = dirname(candidatePath).split(/[\\/]/).filter(Boolean);
  const currentDirs = dirname(currentFile).split(/[\\/]/).filter(Boolean);

  // Find common prefix length.
  let common = 0;
  const max = Math.min(candidateDirs.length, currentDirs.length);
  while (common < max && candidateDirs[common] === currentDirs[common]) {
    common++;
  }

  // Distance = directories you'd have to walk up + over to reach the candidate.
  const distance =
    candidateDirs.length - common + (currentDirs.length - common);

  // Cap at 20 (matches fff.nvim's clamp). Each unit ~2.5% penalty.
  // Floor at 0.5 so even far-away files don't get crushed.
  const clamped = Math.min(20, distance);
  return Math.max(0.5, 1.0 - 0.025 * clamped);
}

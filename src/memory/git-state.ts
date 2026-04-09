import { execSync } from "node:child_process";

// Issue #3: on a fresh git repo with no commits, `git rev-parse HEAD`
// writes a warning to stderr ("Use '--' to separate paths from revisions"
// and similar). Previous versions let that stderr leak through and
// poisoned the very first `sverklo init` output a new user sees.
//
// The fix has two parts:
//   1. stdio: ['ignore', 'pipe', 'ignore'] — drop any stderr git emits
//   2. HEAD-exists pre-check — avoid calling rev-parse at all on repos
//      that have no commits yet. Sverklo's bi-temporal memory has
//      nothing to anchor to in an uncommitted repo, so falling back
//      to git-less mode is the correct behavior.
export function getGitState(rootPath: string): { sha: string | null; branch: string | null } {
  // Probe: does HEAD resolve to anything? On a fresh repo with no
  // commits, this returns non-zero and we return the null state
  // without ever triggering the stderr warning.
  try {
    execSync("git rev-parse --verify HEAD", {
      cwd: rootPath,
      stdio: ["ignore", "ignore", "ignore"],
      timeout: 5000,
    });
  } catch {
    return { sha: null, branch: null };
  }

  // HEAD exists — safe to query the actual SHA and branch.
  try {
    const sha = execSync("git rev-parse HEAD", {
      cwd: rootPath,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).trim();
    const branch = execSync("git branch --show-current", {
      cwd: rootPath,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).trim();
    return { sha: sha || null, branch: branch || null };
  } catch {
    return { sha: null, branch: null };
  }
}

import { spawnSync } from "node:child_process";
import { posix } from "node:path";
import type { DiffEntry, DiffSet, DiffStatus } from "./types.js";

// Parse `git diff --name-only` and `--name-status` output into a DiffSet.
// Stays sync because the rest of the pipeline reads SQLite synchronously
// and the git invocation blocks on the same boundary.

export interface RunGitDiffOptions {
  baseRef?: string;
  cwd: string;
}

export class GitDiffError extends Error {
  constructor(message: string, public readonly stderr: string) {
    super(message);
    this.name = "GitDiffError";
  }
}

export function parseStatusLine(line: string): DiffEntry | null {
  // `--name-status` emits one of:
  //   M\tpath
  //   A\tpath
  //   D\tpath
  //   R100\told\tnew      (rename score)
  //   C100\told\tnew      (copy — treat as add of new)
  const parts = line.split("\t");
  if (parts.length < 2) return null;
  const code = parts[0]?.[0];
  if (!code) return null;
  switch (code) {
    case "A":
    case "C":
      return { path: posix.normalize(parts[1]), status: "added" };
    case "M":
      return { path: posix.normalize(parts[1]), status: "modified" };
    case "D":
      return { path: posix.normalize(parts[1]), status: "deleted" };
    case "R": {
      if (parts.length < 3) return null;
      return {
        path: posix.normalize(parts[2]),
        oldPath: posix.normalize(parts[1]),
        status: "renamed",
      };
    }
    default:
      return null;
  }
}

export function runGitDiff(opts: RunGitDiffOptions): DiffSet {
  const baseRef = opts.baseRef ?? "HEAD";
  const result = spawnSync(
    "git",
    ["diff", "--name-status", baseRef],
    {
      cwd: opts.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    },
  );

  if (result.error) {
    throw new GitDiffError(
      `failed to spawn git: ${result.error.message}`,
      result.stderr ?? "",
    );
  }
  if (result.status !== 0) {
    throw new GitDiffError(
      `git diff exited with ${result.status}`,
      result.stderr ?? "",
    );
  }

  const entries: DiffEntry[] = [];
  for (const raw of result.stdout.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const entry = parseStatusLine(line);
    if (entry) entries.push(entry);
  }

  return { entries, baseRef, parsedAt: Date.now() };
}

// Get the content of a file at HEAD (or any ref) — used to reconstruct
// the "pre" state for files modified in the working tree.
export function getFileAtRef(
  cwd: string,
  ref: string,
  filePath: string,
): string | null {
  const result = spawnSync(
    "git",
    ["show", `${ref}:${filePath}`],
    {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    },
  );
  if (result.status !== 0) return null;
  return result.stdout;
}

// File-path predicate for excluding paths that sverklo doesn't index.
// Mirrors the default ignore set; sverklo workspace .gitignore handling
// is layered on top of this for full parity with `sverklo audit`.
const DEFAULT_IGNORED_PREFIXES = [
  "node_modules/",
  "dist/",
  ".sverklo/",
  ".git/",
  "coverage/",
];

export function isAnalyzablePath(p: string): boolean {
  const norm = p.startsWith("/") ? p.slice(1) : p;
  return !DEFAULT_IGNORED_PREFIXES.some((prefix) => norm.startsWith(prefix));
}

export function analyzableEntries(diffSet: DiffSet): DiffEntry[] {
  return diffSet.entries.filter(
    (e) => e.status !== "deleted" && isAnalyzablePath(e.path),
  );
}

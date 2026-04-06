import { execSync } from "node:child_process";

export function getGitState(rootPath: string): { sha: string | null; branch: string | null } {
  try {
    const sha = execSync("git rev-parse HEAD", { cwd: rootPath, encoding: "utf-8", timeout: 5000 }).trim();
    const branch = execSync("git branch --show-current", { cwd: rootPath, encoding: "utf-8", timeout: 5000 }).trim();
    return { sha: sha || null, branch: branch || null };
  } catch {
    return { sha: null, branch: null };
  }
}

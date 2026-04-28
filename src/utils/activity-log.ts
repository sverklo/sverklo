import { appendFileSync, statSync, renameSync, readFileSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";
import { homedir } from "node:os";

export interface ActivityEntry {
  ts: number;
  event: string;
  detail: Record<string, unknown>;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

function activityDir(projectPath: string): string {
  const hash = createHash("sha256").update(projectPath).digest("hex").slice(0, 12);
  // Issue #20: basename() is platform-aware.
  const name = basename(projectPath) || "unknown";
  return join(homedir(), ".sverklo", `${name}-${hash}`);
}

function activityPath(projectPath: string): string {
  return join(activityDir(projectPath), "activity.jsonl");
}

export function logActivity(
  projectPath: string,
  event: string,
  detail: Record<string, unknown>
): void {
  try {
    const dir = activityDir(projectPath);
    mkdirSync(dir, { recursive: true });
    const filePath = activityPath(projectPath);

    // Auto-rotate at 5MB
    try {
      const stat = statSync(filePath);
      if (stat.size > MAX_FILE_SIZE) {
        renameSync(filePath, filePath + ".1");
      }
    } catch {
      // File doesn't exist yet
    }

    const entry: ActivityEntry = { ts: Date.now(), event, detail };
    appendFileSync(filePath, JSON.stringify(entry) + "\n");
  } catch {
    // Activity logging is best-effort, never throw
  }
}

export function getActivityLog(projectPath: string, limit: number = 30): ActivityEntry[] {
  try {
    const filePath = activityPath(projectPath);
    const content = readFileSync(filePath, "utf-8").trim();
    if (!content) return [];

    const lines = content.split("\n");
    const recent = lines.slice(-limit);
    const entries: ActivityEntry[] = [];

    for (const line of recent) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // Skip malformed lines
      }
    }

    return entries;
  } catch {
    return [];
  }
}

export { activityPath };

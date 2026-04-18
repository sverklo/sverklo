import { join } from "node:path";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import type { AuditAnalysis } from "../server/audit-analysis.js";

export interface AuditHistoryEntry {
  sha: string;
  date: string;
  grade: string;
  numericScore: number;
  dimensions: { name: string; grade: string; score: number }[];
}

const MAX_ENTRIES = 100;

function projectDir(projectPath: string): string {
  const hash = createHash("sha256").update(projectPath).digest("hex").slice(0, 12);
  const name = projectPath.split("/").pop() || "unknown";
  return join(homedir(), ".sverklo", `${name}-${hash}`);
}

function historyPath(projectPath: string): string {
  return join(projectDir(projectPath), "audit-history.json");
}

function getGitSha(projectPath: string): string {
  try {
    return execSync("git rev-parse HEAD", { cwd: projectPath, encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

export function appendAuditHistory(projectPath: string, analysis: AuditAnalysis): void {
  const dir = projectDir(projectPath);
  mkdirSync(dir, { recursive: true });

  const filePath = historyPath(projectPath);
  let entries: AuditHistoryEntry[] = [];
  if (existsSync(filePath)) {
    try {
      entries = JSON.parse(readFileSync(filePath, "utf-8"));
    } catch {
      entries = [];
    }
  }

  const entry: AuditHistoryEntry = {
    sha: getGitSha(projectPath),
    date: new Date().toISOString().slice(0, 10),
    grade: analysis.healthScore.grade,
    numericScore: analysis.healthScore.numericScore,
    dimensions: analysis.healthScore.dimensions.map((d) => ({
      name: d.name,
      grade: d.grade,
      score: d.score,
    })),
  };

  entries.push(entry);

  // Keep last MAX_ENTRIES (FIFO)
  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(entries.length - MAX_ENTRIES);
  }

  writeFileSync(filePath, JSON.stringify(entries, null, 2) + "\n");
}

export function getAuditHistory(projectPath: string): AuditHistoryEntry[] {
  const filePath = historyPath(projectPath);
  if (!existsSync(filePath)) return [];
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return [];
  }
}

/** Format a trend string from an array of grades, e.g. "D -> C -> B (improving)" */
export function formatTrend(grades: string[]): string {
  if (grades.length < 2) return "";

  const GRADE_ORDER: Record<string, number> = { A: 5, B: 4, C: 3, D: 2, F: 1 };
  const first = GRADE_ORDER[grades[0]] ?? 0;
  const last = GRADE_ORDER[grades[grades.length - 1]] ?? 0;
  const arrow = grades.join(" \u2192 ");

  if (last > first) return `${arrow} (improving \u2191)`;
  if (last < first) return `${arrow} (declining \u2193)`;
  return `${arrow} (stable \u2192)`;
}

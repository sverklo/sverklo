import { execFile } from "node:child_process";

export interface SemgrepFinding {
  path: string;
  line: number;
  rule: string;
  message: string;
  severity: "INFO" | "WARNING" | "ERROR";
}

/** Check if semgrep is installed. */
export async function isSemgrepInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("which", ["semgrep"], (error) => {
      resolve(!error);
    });
  });
}

/**
 * Run semgrep on a project and return normalized findings.
 * Returns empty array if semgrep is not installed or fails.
 */
export async function runSemgrep(projectPath: string): Promise<SemgrepFinding[]> {
  return new Promise((resolve) => {
    execFile(
      "semgrep",
      ["scan", "--config", "auto", "--quiet", "--json", projectPath],
      { maxBuffer: 50 * 1024 * 1024, timeout: 5 * 60 * 1000 },
      (error, stdout) => {
        if (error || !stdout) {
          resolve([]);
          return;
        }
        try {
          const parsed = JSON.parse(stdout);
          const results: unknown[] = parsed.results ?? [];
          const findings: SemgrepFinding[] = results.map((r: any) => ({
            path: r.path ?? "",
            line: r.start?.line ?? 0,
            rule: r.check_id ?? "unknown",
            message: r.extra?.message ?? "",
            severity: normalizeSeverity(r.extra?.severity ?? "INFO"),
          }));
          resolve(findings);
        } catch {
          resolve([]);
        }
      },
    );
  });
}

function normalizeSeverity(s: string): SemgrepFinding["severity"] {
  const upper = s.toUpperCase();
  if (upper === "ERROR") return "ERROR";
  if (upper === "WARNING") return "WARNING";
  return "INFO";
}

/** Map semgrep severity to audit security severity. */
export function semgrepSeverityToAudit(s: SemgrepFinding["severity"]): "critical" | "high" | "low" {
  if (s === "ERROR") return "critical";
  if (s === "WARNING") return "high";
  return "low";
}

/** Format semgrep findings as a markdown section. */
export function formatSemgrepSection(findings: SemgrepFinding[]): string {
  if (findings.length === 0) {
    return "## Deep Security Scan (semgrep)\n\nNo additional concerns found.\n";
  }

  const warnings = findings.filter((f) => f.severity === "WARNING");
  const errors = findings.filter((f) => f.severity === "ERROR");
  const infos = findings.filter((f) => f.severity === "INFO");

  const lines: string[] = [];
  lines.push("## Deep Security Scan (semgrep)");
  lines.push("");
  lines.push(
    `Found ${findings.length} additional concern${findings.length === 1 ? "" : "s"} (${errors.length} critical, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}, ${infos.length} info).`,
  );
  lines.push("");

  const renderGroup = (label: string, items: SemgrepFinding[]) => {
    if (items.length === 0) return;
    lines.push(`### ${label} (${items.length})`);
    for (const f of items.slice(0, 20)) {
      lines.push(`- **${f.rule}** — \`${f.path}:${f.line}\``);
      if (f.message) lines.push(`  ${f.message}`);
    }
    if (items.length > 20) {
      lines.push(`- _...and ${items.length - 20} more_`);
    }
    lines.push("");
  };

  renderGroup("Critical", errors);
  renderGroup("Warnings", warnings);
  renderGroup("Info", infos);

  return lines.join("\n");
}

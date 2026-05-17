import type { ArchitecturalViolation, AuditReport } from "./types.js";

// Reporter: human-readable + JSON output for AuditReport. Matches
// contracts/cli.md and contracts/json-output.md.

export function toJSON(report: AuditReport): string {
  return JSON.stringify(report, null, 2);
}

export function toHuman(report: AuditReport, verbose: boolean): string {
  if (report.pass && !verbose) {
    return ""; // intentional silence on pass
  }

  const lines: string[] = [];

  if (!report.pass) {
    const cycles = report.violations.filter((v) => v.kind === "cycle");
    const spikes = report.violations.filter((v) => v.kind === "fan_in_spike");

    if (cycles.length > 0) {
      lines.push("✗ audit-diff: new circular dependency detected");
      lines.push("");
      for (const c of cycles) {
        if (c.kind !== "cycle") continue;
        lines.push(
          `  cycle: ${c.nodes.join(" → ")} → ${c.nodes[0]} (${c.nodes.length} files)`,
        );
      }
      lines.push("");
      const first = cycles[0];
      if (first && first.kind === "cycle" && first.nodes[0]) {
        lines.push(`Run \`sverklo deps ${first.nodes[0]}\` for the full neighborhood.`);
      }
    }

    if (spikes.length > 0) {
      if (cycles.length > 0) lines.push("");
      lines.push("✗ audit-diff: fan-in threshold crossed by this diff");
      lines.push("");
      for (const s of spikes) {
        if (s.kind !== "fan_in_spike") continue;
        lines.push(
          `  ${s.file}  fan-in ${s.preFanIn} → ${s.postFanIn}  (threshold: ${s.threshold})`,
        );
      }
      lines.push("");
      const first = spikes[0];
      if (first && first.kind === "fan_in_spike") {
        lines.push(
          `Run \`sverklo refs ${first.file}\` to see new importers.`,
        );
      }
    }
  } else if (verbose) {
    lines.push(
      `audit-diff: pass · boundary_nodes=${report.stats.boundary_node_count} boundary_edges=${report.stats.boundary_edge_count} elapsed_ms=${report.stats.elapsed_ms}`,
    );
  }

  if (verbose && report.pre_existing.length > 0) {
    lines.push("");
    lines.push("Pre-existing violations (not blocking):");
    for (const v of report.pre_existing) {
      lines.push(`  · ${describeViolation(v)}`);
    }
  }

  return lines.join("\n");
}

function describeViolation(v: ArchitecturalViolation): string {
  if (v.kind === "cycle") return `cycle: ${v.nodes.join(" → ")}`;
  return `fan-in ${v.postFanIn} at ${v.file} (threshold ${v.threshold})`;
}

export function emptyReport(baseRef: string): AuditReport {
  return {
    schema_version: "1",
    pass: true,
    diff: {
      base_ref: baseRef,
      modified_paths: [],
      analyzable_paths: [],
    },
    violations: [],
    pre_existing: [],
    stats: {
      boundary_node_count: 0,
      boundary_edge_count: 0,
      elapsed_ms: 0,
    },
    warnings: [],
  };
}

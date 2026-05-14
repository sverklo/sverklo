/**
 * Generate Obsidian-compatible markdown with [[wikilinks]] for the audit report.
 * Single file output — open in Obsidian for clickable dependency navigation.
 */

import type { IndexFiles } from "../indexer/index-files.js";
import type { IndexCode } from "../indexer/index-code.js";
import type { IndexGraph } from "../indexer/index-graph.js";
import { type AuditAnalysis, isVendoredPath } from "./audit-analysis.js";

export function generateAuditObsidian(
  indexer: IndexFiles & IndexCode & IndexGraph,
  analysis: AuditAnalysis,
  projectName: string,
): string {
  const files = indexer.fileStore.getAll();
  const edges = indexer.graphStore.getAll();

  // Build lookup maps
  const idToPath = new Map<number, string>();
  for (const f of files) idToPath.set(f.id, f.path);

  // Build import/imported-by maps
  const imports = new Map<string, string[]>();      // file -> files it imports
  const importedBy = new Map<string, string[]>();   // file -> files that import it

  for (const e of edges) {
    const src = idToPath.get(e.source_file_id);
    const tgt = idToPath.get(e.target_file_id);
    if (!src || !tgt) continue;
    if (!imports.has(src)) imports.set(src, []);
    imports.get(src)!.push(tgt);
    if (!importedBy.has(tgt)) importedBy.set(tgt, []);
    importedBy.get(tgt)!.push(src);
  }

  const lines: string[] = [];
  const { healthScore, securityIssues, circularDeps } = analysis;
  const date = new Date().toISOString().slice(0, 10);

  // ─── 1. Header ───
  lines.push(`# ${projectName} — Audit Report`);
  lines.push("");
  lines.push(`- **Grade**: ${healthScore.grade} (${healthScore.numericScore.toFixed(1)}/5)`);
  lines.push(`- **Date**: ${date}`);
  lines.push(`- **Files**: ${files.length}`);
  lines.push(`- **Circular deps**: ${circularDeps.length}`);
  lines.push(`- **Security issues**: ${securityIssues.length}`);
  lines.push("");

  // ─── 2. Health Score ───
  lines.push("## Health Score");
  lines.push("");
  lines.push("| Dimension | Grade | Detail |");
  lines.push("|---|---|---|");
  for (const d of healthScore.dimensions) {
    lines.push(`| ${d.name} | ${d.grade} | ${d.detail} |`);
  }
  lines.push("");

  // ─── 3. File Dependency Map ───
  lines.push("## File Dependency Map");
  lines.push("");
  for (const f of files) {
    const imp = imports.get(f.path) || [];
    const impBy = importedBy.get(f.path) || [];
    if (imp.length === 0 && impBy.length === 0 && f.pagerank === 0) continue;

    lines.push(`### [[${f.path}]]`);
    lines.push(`- PageRank: ${f.pagerank.toFixed(3)}`);
    if (imp.length > 0) {
      lines.push(`- Imports: ${imp.map((p) => `[[${p}]]`).join(", ")}`);
    }
    if (impBy.length > 0) {
      lines.push(`- Imported by: ${impBy.map((p) => `[[${p}]]`).join(", ")}`);
    }
    lines.push("");
  }

  // ─── 4. God Nodes ───
  // Same ranking signal as sverklo_audit (refs × √distinct-files,
  // restricted to non-vendored project definitions). Dogfood T2.
  const allChunks = indexer.chunkStore.getAllWithFile();
  const godStats = indexer.symbolRefStore.getGodNodeStats();
  const definedFile = new Map<string, string>();
  for (const c of allChunks) {
    if (!c.name) continue;
    if (isVendoredPath(c.filePath)) continue;
    if (!definedFile.has(c.name)) definedFile.set(c.name, c.filePath);
  }

  const godNodes = godStats
    .filter((s) => definedFile.has(s.target_name))
    .map((s) => ({
      name: s.target_name,
      count: s.ref_count,
      files: s.distinct_source_files,
      file: definedFile.get(s.target_name)!,
    }))
    .sort(
      (a, b) =>
        b.count * Math.sqrt(b.files) - a.count * Math.sqrt(a.files),
    )
    .slice(0, 10);

  if (godNodes.length > 0) {
    lines.push("## God Nodes");
    lines.push("");
    for (const g of godNodes) {
      lines.push(
        `- **${g.name}** — ${g.count} refs across ${g.files} file${g.files === 1 ? "" : "s"} — [[${g.file}]]`,
      );
    }
    lines.push("");
  }

  // ─── 5. Circular Dependencies ───
  if (circularDeps.length > 0) {
    lines.push(`## Circular Dependencies (${circularDeps.length})`);
    lines.push("");
    for (const cycle of circularDeps) {
      const chain = [...cycle, cycle[0]].map((p) => `[[${p}]]`).join(" → ");
      lines.push(`- ${chain}`);
    }
    lines.push("");
  }

  // ─── 6. Hub Files ───
  const hubs = files.filter((f) => f.pagerank > 0).slice(0, 15);
  if (hubs.length > 0) {
    lines.push("## Hub Files");
    lines.push("");
    for (const h of hubs) {
      lines.push(`- [[${h.path}]] — PageRank ${h.pagerank.toFixed(3)}`);
    }
    lines.push("");
  }

  // ─── 7. Security Findings ───
  if (securityIssues.length > 0) {
    lines.push(`## Security Findings (${securityIssues.length})`);
    lines.push("");

    // Group by file
    const byFile = new Map<string, typeof securityIssues>();
    for (const issue of securityIssues) {
      if (!byFile.has(issue.file)) byFile.set(issue.file, []);
      byFile.get(issue.file)!.push(issue);
    }

    for (const [file, issues] of byFile) {
      lines.push(`### [[${file}]]`);
      for (const issue of issues) {
        lines.push(`- **${issue.severity}** — ${issue.pattern} (line ${issue.line})`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

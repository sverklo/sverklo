import type { IndexFiles } from "../../indexer/index-files.js";
import type { IndexCode } from "../../indexer/index-code.js";
import type { IndexGraph } from "../../indexer/index-graph.js";
import type { IndexMemory } from "../../indexer/index-memory.js";
import { resolveBudget } from "../../utils/budget.js";
import { analyzeCodebase, isVendoredPath } from "../audit-analysis.js";
import { getAuditHistory, formatTrend } from "../../utils/audit-history.js";

export const auditTool = {
  name: "sverklo_audit",
  description:
    "One-call codebase health report: god nodes (highest blast-radius symbols), " +
    "hub files (highest PageRank), orphan symbols (likely dead code), and " +
    "language/memory stats. Use as the seed for a code-quality pass — pair " +
    "with sverklo_impact for blast-radius and sverklo_deps for fan-in/fan-out. " +
    "Cheaper than running overview + impact + dependencies separately.",
  inputSchema: {
    type: "object" as const,
    properties: {
      token_budget: {
        type: "number",
        description: "Max tokens to return (default: 4000)",
      },
    },
  },
};

interface GodNode {
  name: string;
  refCount: number;
  distinctFiles: number;
}

export function handleAudit(indexer: IndexFiles & IndexCode & IndexGraph & IndexMemory, args: Record<string, unknown>): string {
  const tokenBudget = resolveBudget(args, "audit", null, 4000);
  const files = indexer.fileStore.getAll();
  const chunkCount = indexer.chunkStore.count();
  const symbolRefCount = indexer.symbolRefStore.count();

  // Get all named chunks once (used by god nodes + orphans)
  const allChunks = indexer.chunkStore.getAllWithFile();

  // ─── God nodes: symbols with the highest structural blast radius ───
  //
  // Prior version ranked by raw ref-count. Result: method names like
  // `get`, `json`, `set`, `value`, `request` dominated the top 10 because
  // they're referenced many times from one or two source files. Those are
  // not god nodes; they're common method names. (Dogfood T2 review
  // 2026-05-13.)
  //
  // New ranking signal: refs × sqrt(distinct importing files). A name
  // referenced 30 times across 30 different files outranks one referenced
  // 200 times from one file. sqrt damps the per-file dimension so a
  // genuinely-hot name in 2-3 files (e.g. a frequently-called util)
  // can still surface.
  //
  // Plus we restrict to symbols whose definitions are in NON-vendored
  // project files. Without that, methods on Express's HTTP verb
  // primitives would top the chart on any repo that depended on Express.
  const godStats = indexer.symbolRefStore.getGodNodeStats();

  // For each name, find a non-vendored definition. If a name is ONLY
  // defined in vendored paths (e.g. benchmark/.cache/express/lib/router.js),
  // it doesn't represent the user's own codebase and shouldn't rank.
  const nameToProjectDef = new Map<string, { type: string }>();
  for (const c of allChunks) {
    if (!c.name) continue;
    if (isVendoredPath(c.filePath)) continue;
    const existing = nameToProjectDef.get(c.name);
    // Prefer concrete defs (class/interface/function) over methods —
    // when a name has multiple defs, the more architectural one wins.
    const typeRank = (t: string): number => {
      if (t === "class" || t === "interface") return 4;
      if (t === "function" || t === "type") return 3;
      if (t === "method") return 2;
      return 1;
    };
    if (!existing || typeRank(c.type) > typeRank(existing.type)) {
      nameToProjectDef.set(c.name, { type: c.type });
    }
  }

  const godNodes: GodNode[] = godStats
    .filter((s) => nameToProjectDef.has(s.target_name))
    .map((s) => ({
      name: s.target_name,
      refCount: s.ref_count,
      distinctFiles: s.distinct_source_files,
    }))
    .sort((a, b) => {
      const scoreA = a.refCount * Math.sqrt(a.distinctFiles);
      const scoreB = b.refCount * Math.sqrt(b.distinctFiles);
      return scoreB - scoreA;
    })
    .slice(0, 10);

  // Refs lookup used by the orphan-detection loop below. Re-derived from
  // the same godStats query so we don't pay for symbolRefStore.getAll()
  // separately. Same shape as the prior Map<name, count>.
  const refsByName = new Map<string, number>();
  for (const s of godStats) refsByName.set(s.target_name, s.ref_count);

  // ─── Hub files by PageRank ───
  const hubFiles = files.slice(0, 10).map((f) => ({
    path: f.path,
    pagerank: f.pagerank,
    language: f.language,
  }));

  // ─── Orphans: named symbols with zero references ───
  // Method/qualified chunks are stored as "Receiver.method" or "exports.foo",
  // but the symbol extractor records call sites under the BARE name (`method`).
  // Check both the qualified and the unqualified suffix so CJS prototype
  // methods and `exports.X` aren't falsely flagged as dead.
  // Also skip non-shipping locations (tests, examples, benchmarks, scripts) —
  // they're full of helpers that are "used" via test runners or doc snippets
  // sverklo can't see, and flagging them as dead code is pure noise.
  const NON_SHIPPING = /(^|\/)(tests?|__tests__|spec|specs|examples?|benchmarks?|fixtures?|scripts?|docs?)(\/|$)/;
  const namedChunks = allChunks.filter(
    (c) =>
      c.name &&
      (c.type === "function" || c.type === "class" || c.type === "method") &&
      !NON_SHIPPING.test(c.filePath)
  );
  // Build set of high-PageRank file paths — symbols in heavily-imported files
  // are clearly being used even if the symbol extractor misses the reference pattern
  const highPrFiles = new Set(
    files.filter((f) => f.pagerank > 0.05).map((f) => f.path)
  );

  const orphans: { name: string; type: string; file: string; line: number }[] = [];
  let orphanTotal = 0;
  const MAX_ORPHANS = 15;
  // Bug-bash 2 finding: previously we early-returned at MAX_ORPHANS, so
  // the "Suggested Next Steps" section under-reported the orphan count
  // ("15+ potential orphans" even when the real number was 200+). Walk
  // the full set to compute a true total, but only keep MAX_ORPHANS for
  // the rendered list.
  const DECORATOR_ENTRY = /@(?:Get|Post|Put|Delete|Patch|Head|Options|All|Sse|Subscribe|OnEvent|OnMessage|MessagePattern|EventPattern|Cron|Interval|Timeout|UseGuards|UseInterceptors|UsePipes|UseFilters|Render|Header|Redirect|HttpCode|Query|Param|Body|Req|Res|Next|Session|UploadedFile|HostParam|Controller|Injectable|Module|Resolver|Mutation|Subscription|ResolveField|OnModuleInit|OnModuleDestroy|BeforeInsert|AfterInsert|BeforeUpdate|AfterUpdate|BeforeRemove|AfterRemove|EventSubscriber|Entity|Column|PrimaryColumn|PrimaryGeneratedColumn|CreateDateColumn|UpdateDateColumn|OneToMany|ManyToOne|ManyToMany|OneToOne)\s*\(/;
  for (const c of namedChunks) {
    if (["main", "default", "index", "__init__", "constructor"].includes(c.name!)) continue;
    if (highPrFiles.has(c.filePath)) continue;
    if (c.content && DECORATOR_ENTRY.test(c.content)) continue;
    const fullName = c.name!;
    const dot = fullName.lastIndexOf(".");
    const bareName = dot >= 0 ? fullName.slice(dot + 1) : fullName;
    const refs =
      (refsByName.get(fullName) || 0) +
      (dot >= 0 ? (refsByName.get(bareName) || 0) : 0);
    if (refs === 0) {
      orphanTotal++;
      if (orphans.length < MAX_ORPHANS) {
        orphans.push({
          name: fullName,
          type: c.type,
          file: c.filePath,
          line: c.start_line,
        });
      }
    }
  }

  // ─── Coupling: files with most mutual dependencies ───
  // File-level PageRank already captures this — use it as a proxy
  const coupledFiles = files
    .filter((f) => f.pagerank > 0.1)
    .slice(0, 5)
    .map((f) => ({
      path: f.path,
      pagerank: f.pagerank,
    }));

  // ─── Memory summary ───
  const memoryCount = indexer.memoryStore.count();
  const staleMemories = indexer.memoryStore.getStale();
  const coreMemories = indexer.memoryStore.getCore(100);

  // ─── Language distribution ───
  const languages: Record<string, number> = {};
  for (const f of files) {
    if (f.language) languages[f.language] = (languages[f.language] || 0) + 1;
  }
  const sortedLangs = Object.entries(languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // ─── Run analysis (health score, security, circular deps) ───
  const analysis = analyzeCodebase(indexer);

  // ─── Build markdown report with section-level budgeting ───
  const sections: string[] = [];
  let usedTokens = 0;
  const maxTokens = tokenBudget;

  function addSection(section: string): boolean {
    const cost = Math.ceil(section.length / 3.5);
    if (usedTokens + cost > maxTokens) {
      sections.push("\n_[remaining sections omitted to fit token_budget]_");
      return false;
    }
    sections.push(section);
    usedTokens += cost;
    return true;
  }

  // Header with grade + health score table
  {
    const hsLines: string[] = [];
    hsLines.push(`# Sverklo Project Audit — Grade: ${analysis.healthScore.grade}\n`);
    hsLines.push(`| Dimension | Score | Detail |`);
    hsLines.push(`|---|---|---|`);
    for (const d of analysis.healthScore.dimensions) {
      hsLines.push(`| ${d.name} | ${d.grade} | ${d.detail} |`);
    }
    hsLines.push("");
    if (!addSection(hsLines.join("\n"))) return sections.join("\n");
  }

  // Overview
  const overviewLines: string[] = [];
  overviewLines.push(`## Overview\n`);
  overviewLines.push(`- **${files.length}** files indexed`);
  overviewLines.push(`- **${chunkCount}** code symbols extracted`);
  overviewLines.push(`- **${symbolRefCount}** symbol references tracked`);
  overviewLines.push(`- **${memoryCount}** active memories (${coreMemories.length} core, ${staleMemories.length} stale)`);
  overviewLines.push(`- Languages: ${sortedLangs.map(([l, c]) => `${l} (${c})`).join(", ")}`);
  overviewLines.push("");
  if (!addSection(overviewLines.join("\n"))) return sections.join("\n");

  // God nodes
  if (godNodes.length > 0) {
    const godLines: string[] = [];
    godLines.push(`## God Nodes (most-referenced symbols)`);
    godLines.push(`These are the symbols your codebase depends on most. Changes here have the largest blast radius.`);
    godLines.push("");
    for (const g of godNodes.slice(0, 10)) {
      godLines.push(
        `- **${g.name}** — ${g.refCount} references across ${g.distinctFiles} file${g.distinctFiles === 1 ? "" : "s"}`,
      );
    }
    godLines.push("");
    if (!addSection(godLines.join("\n"))) return sections.join("\n");
  }

  // Hub files
  {
    const hubLines: string[] = [];
    hubLines.push(`## Hub Files (highest PageRank)`);
    hubLines.push(`Core architectural files — imported by many others.`);
    hubLines.push("");
    for (const h of hubFiles) {
      if (h.pagerank > 0) {
        hubLines.push(`- \`${h.path}\` (${h.pagerank.toFixed(2)})`);
      }
    }
    hubLines.push("");
    if (!addSection(hubLines.join("\n"))) return sections.join("\n");
  }

  // Orphans / dead code candidates
  {
    const orphanLines: string[] = [];
    if (orphans.length > 0) {
      const totalSuffix = orphanTotal > orphans.length ? ` of ${orphanTotal} total` : "";
      orphanLines.push(`## Orphans (potential dead code)${totalSuffix ? ` — showing ${Math.min(10, orphans.length)}${totalSuffix}` : ""}`);
      orphanLines.push(`Named ${orphans[0].type}s with zero detected references. Could be dead code, public API exports, or referenced dynamically.`);
      orphanLines.push("");
      for (const o of orphans.slice(0, 10)) {
        orphanLines.push(`- **${o.name}** — \`${o.file}:${o.line}\``);
      }
      orphanLines.push("");
    } else {
      orphanLines.push(`## Orphans`);
      orphanLines.push(`No obvious dead code — every named symbol has at least one reference.`);
      orphanLines.push("");
    }
    if (!addSection(orphanLines.join("\n"))) return sections.join("\n");
  }

  // Coupling (high PageRank files)
  if (coupledFiles.length > 0) {
    const couplingLines: string[] = [];
    couplingLines.push(`## Coupling (high-PageRank files)`);
    for (const f of coupledFiles) {
      couplingLines.push(`- \`${f.path}\` (${f.pagerank.toFixed(2)})`);
    }
    couplingLines.push("");
    if (!addSection(couplingLines.join("\n"))) return sections.join("\n");
  }

  // Memory health
  if (memoryCount > 0) {
    const memLines: string[] = [];
    memLines.push(`## Memory Health`);
    memLines.push(`- **${coreMemories.length}** core memories (auto-injected each session)`);
    memLines.push(`- **${memoryCount - coreMemories.length}** archive memories (searched on demand)`);
    if (staleMemories.length > 0) {
      memLines.push(`- **${staleMemories.length}** stale memories — consider \`sverklo_forget\` or \`sverklo_remember\` to update`);
    }
    memLines.push("");
    if (!addSection(memLines.join("\n"))) return sections.join("\n");
  }

  // Circular Dependencies
  if (analysis.circularDeps.length > 0) {
    const cycleLines: string[] = [];
    cycleLines.push(
      `## Circular Dependencies (${analysis.circularDeps.length} cycle${analysis.circularDeps.length === 1 ? "" : "s"})`
    );
    cycleLines.push("");
    for (let i = 0; i < analysis.circularDeps.length; i++) {
      const cycle = analysis.circularDeps[i];
      // Show as: a -> b -> c -> a (closing the loop)
      const display = [...cycle, cycle[0]].join(" -> ");
      cycleLines.push(`${i + 1}. ${display}`);
    }
    cycleLines.push("");
    if (!addSection(cycleLines.join("\n"))) return sections.join("\n");
  }

  // Security Issues
  if (analysis.securityIssues.length > 0) {
    const secLines: string[] = [];
    secLines.push(
      `## Security Issues (${analysis.securityIssues.length} found)`
    );
    secLines.push("");
    // Group by severity
    const bySeverity = new Map<string, typeof analysis.securityIssues>();
    for (const issue of analysis.securityIssues) {
      if (!bySeverity.has(issue.severity)) bySeverity.set(issue.severity, []);
      bySeverity.get(issue.severity)!.push(issue);
    }
    const severityOrder = ["critical", "high", "medium", "low"];
    for (const sev of severityOrder) {
      const group = bySeverity.get(sev);
      if (!group || group.length === 0) continue;
      secLines.push(`### ${sev.charAt(0).toUpperCase() + sev.slice(1)} (${group.length})`);
      for (const issue of group.slice(0, 10)) {
        secLines.push(
          `- **${issue.pattern}** — \`${issue.file}:${issue.line}\``
        );
        secLines.push(`  \`${issue.snippet}\``);
      }
      if (group.length > 10) {
        secLines.push(`- _...and ${group.length - 10} more_`);
      }
      secLines.push("");
    }
    if (!addSection(secLines.join("\n"))) return sections.join("\n");
  }

  // Suggested queries
  if (godNodes.length > 0) {
    const suggestLines: string[] = [];
    suggestLines.push(`## Suggested Next Steps`);
    if (godNodes.length > 0) {
      suggestLines.push(`- Before refactoring **${godNodes[0].name}**, run \`sverklo_impact\` to see the ${godNodes[0].refCount} call sites`);
    }
    if (hubFiles[0]) {
      suggestLines.push(`- \`${hubFiles[0].path}\` is your most-imported file — changes here cascade widely`);
    }
    if (orphanTotal > 3) {
      suggestLines.push(`- ${orphanTotal} potential orphan${orphanTotal === 1 ? "" : "s"} detected — audit for dead code`);
    }
    suggestLines.push("");
    addSection(suggestLines.join("\n"));
  }

  // Trend from audit history (if available)
  {
    const history = getAuditHistory(indexer.rootPath);
    if (history.length >= 2) {
      const recent = history.slice(-5);
      const grades = recent.map((e) => e.grade);
      const trendLines: string[] = [];
      trendLines.push(`## Trend`);
      trendLines.push(`Last ${recent.length} audits: ${formatTrend(grades)}`);
      trendLines.push("");
      addSection(trendLines.join("\n"));
    }
  }

  // Badge hint at the end of every audit
  {
    const grade = analysis.healthScore.grade;
    const colorMap: Record<string, string> = { A: "brightgreen", B: "green", C: "yellow", D: "orange", F: "red" };
    const color = colorMap[grade] || "lightgrey";
    addSection(`---\n\n**Add this badge to your README:** \`[![Sverklo Health: ${grade}](https://img.shields.io/badge/sverklo-${grade}-${color})](https://sverklo.com)\`\n\nRun \`sverklo audit --badge\` for copy-paste markdown.\n`);
  }

  return sections.join("\n");
}

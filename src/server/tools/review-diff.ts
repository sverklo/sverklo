import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import type { Indexer } from "../../indexer/indexer.js";
import type { CodeChunk, FileRecord } from "../../types/index.js";
import { computeRiskScore, formatRiskBadge, type RiskScore } from "./risk-score.js";
import { isTestPath, candidateTestNames } from "./test-paths.js";
import { getDiffHunks, runAllHeuristics, type HeuristicFinding } from "./diff-heuristics.js";
import { resolveBudget } from "../../utils/budget.js";
import { validateGitRef } from "../../utils/git-validation.js";

export const reviewDiffTool = {
  name: "sverklo_review_diff",
  description:
    "Diff-aware context bundler for code review. Takes a git ref or range and returns: " +
    "changed files, semantic delta (added/removed/modified symbols), dangling references " +
    "for removed symbols, impact set for modified symbols, and similar-symbol detection " +
    "for added ones. Replaces 10-20 grep+read calls with one structured response. " +
    "Use this FIRST when reviewing an MR/PR — it surfaces blast radius and convention " +
    "violations grep cannot see.",
  inputSchema: {
    type: "object" as const,
    properties: {
      ref: {
        type: "string",
        description:
          "Git ref or range. Examples: 'HEAD' (uncommitted + last commit), " +
          "'main..HEAD' (branch vs main), 'abc123..def456'. Default: main..HEAD.",
      },
      include_added_similarity: {
        type: "boolean",
        description: "Detect duplicates among added symbols. Default: true.",
      },
      max_files: {
        type: "number",
        description: "Cap on number of files to analyze. Default: 25.",
      },
      token_budget: {
        type: "number",
        description: "Max tokens to return. Default: 4000.",
      },
    },
  },
};

interface ChangedFile {
  path: string;
  status: "A" | "M" | "D" | "R" | "C" | "T";
  added: number;
  removed: number;
}

interface SymbolChange {
  name: string;
  type: string;
  file: string;
  line: number;
  signature?: string;
}

export function handleReviewDiff(
  indexer: Indexer,
  args: Record<string, unknown>
): string {
  const ref = (args.ref as string) || "main..HEAD";
  const includeSimilarity = args.include_added_similarity !== false;
  const maxFiles = (args.max_files as number) || 25;
  const tokenBudget = resolveBudget(args, "review_diff", null, 4000);

  if (!validateGitRef(ref)) {
    return "Error: invalid git ref. Ref must match a safe refspec pattern (no shell metacharacters).";
  }

  // ─── 1. Get list of changed files ───
  const changedFiles = getChangedFiles(indexer.rootPath, ref);
  if (changedFiles === null) {
    return "Error: not a git repository or invalid ref. Try `sverklo_review_diff ref:HEAD~1..HEAD`.";
  }
  if (changedFiles.length === 0) {
    return `No file changes between \`${ref}\`. Working tree clean or ref invalid.`;
  }

  const cappedFiles = changedFiles.slice(0, maxFiles);
  const truncated = changedFiles.length > maxFiles;

  // ─── 2. Build file→indexed-file lookup ───
  const fileCache = new Map<string, FileRecord>();
  for (const f of indexer.fileStore.getAll()) {
    fileCache.set(f.path, f);
  }

  // ─── 3. Compute semantic delta ───
  // For each modified/added file, get its current symbols.
  // For removed files, the symbols are the deletions.
  // For modified, we compare against pre-change content (parsed from `git show old:path`).
  const removedSymbols: SymbolChange[] = [];
  const addedSymbols: SymbolChange[] = [];
  const modifiedFiles: { path: string; symbols: CodeChunk[] }[] = [];

  for (const cf of cappedFiles) {
    const indexed = fileCache.get(cf.path);

    // Pre-change symbols (parsed from old content via git show)
    const oldSymbols = getOldSymbols(indexer.rootPath, ref, cf.path);

    if (cf.status === "D") {
      // File deleted entirely → all old symbols are removed
      for (const s of oldSymbols) {
        removedSymbols.push({
          name: s.name,
          type: s.type,
          file: cf.path,
          line: s.line,
          signature: s.signature,
        });
      }
      continue;
    }

    // Current symbols (from index — assumes index is fresh)
    const currentSymbols = indexed
      ? indexer.chunkStore.getByFile(indexed.id).filter((c) => c.name)
      : [];

    if (cf.status === "A") {
      // File added → all current symbols are added
      for (const s of currentSymbols) {
        addedSymbols.push({
          name: s.name!,
          type: s.type,
          file: cf.path,
          line: s.start_line,
          signature: s.signature || undefined,
        });
      }
      continue;
    }

    // Modified file: diff old vs current symbols by name
    const oldNames = new Set(oldSymbols.map((s) => s.name));
    const currentNames = new Set(currentSymbols.map((c) => c.name!));

    for (const s of oldSymbols) {
      if (!currentNames.has(s.name)) {
        removedSymbols.push({
          name: s.name,
          type: s.type,
          file: cf.path,
          line: s.line,
          signature: s.signature,
        });
      }
    }
    for (const c of currentSymbols) {
      if (!oldNames.has(c.name!)) {
        addedSymbols.push({
          name: c.name!,
          type: c.type,
          file: cf.path,
          line: c.start_line,
          signature: c.signature || undefined,
        });
      }
    }

    if (currentSymbols.length > 0) {
      modifiedFiles.push({ path: cf.path, symbols: currentSymbols });
    }
  }

  // ─── 4. For each removed symbol, check for dangling references ───
  const danglingRefs: Map<string, { count: number; files: string[] }> = new Map();
  for (const sym of removedSymbols) {
    const refs = indexer.symbolRefStore.getImpact(sym.name, 20);
    if (refs.length > 0) {
      const files = Array.from(new Set(refs.map((r) => r.file_path)));
      danglingRefs.set(sym.name, { count: refs.length, files });
    } else {
      danglingRefs.set(sym.name, { count: 0, files: [] });
    }
  }

  // ─── 5. For each modified file, get its dependency closure ───
  const fileImpact: Map<string, { importers: number; imports: number }> = new Map();
  for (const cf of cappedFiles) {
    if (cf.status === "D" || cf.status === "A") continue;
    const indexed = fileCache.get(cf.path);
    if (!indexed) continue;
    const importers = indexer.graphStore.getImporters(indexed.id);
    const imports = indexer.graphStore.getImports(indexed.id);
    fileImpact.set(cf.path, { importers: importers.length, imports: imports.length });
  }

  // ─── 6. For added symbols, check for similar existing symbols ───
  const duplicateCandidates: { added: SymbolChange; similar: { name: string; file: string; line: number }[] }[] = [];
  if (includeSimilarity) {
    for (const added of addedSymbols.slice(0, 10)) {
      // Find existing chunks with the same exact name (strong signal of duplication)
      const matches = indexer.chunkStore.getByName(added.name, 5);
      const similar = matches
        .filter((m) => m.name === added.name && (fileCache.get(m.file_id ? "" : "")?.path !== added.file))
        .map((m) => {
          const fileEntry = Array.from(fileCache.values()).find((f) => f.id === m.file_id);
          return {
            name: m.name!,
            file: fileEntry?.path || "unknown",
            line: m.start_line,
          };
        })
        .filter((s) => s.file !== added.file);
      if (similar.length > 0) {
        duplicateCandidates.push({ added, similar });
      }
    }
  }

  // ─── 6.5. Compute per-file risk score ───
  // Build a quick lookup of indexed test files so we can answer "is this
  // file tested?" without re-scanning the index per file.
  const allFilesForTests = indexer.fileStore.getAll();
  const testFilesByBasename = new Map<string, true>();
  for (const f of allFilesForTests) {
    if (isTestPath(f.path)) testFilesByBasename.set(basename(f.path), true);
  }

  // Aggregate added/removed/modified symbols per file path
  const symbolsByFile = new Map<string, string[]>();
  const addToSymbolsByFile = (file: string, name: string) => {
    const arr = symbolsByFile.get(file) || [];
    arr.push(name);
    symbolsByFile.set(file, arr);
  };
  for (const s of addedSymbols) addToSymbolsByFile(s.file, s.name);
  for (const s of removedSymbols) addToSymbolsByFile(s.file, s.name);
  for (const m of modifiedFiles) {
    for (const s of m.symbols) if (s.name) addToSymbolsByFile(m.path, s.name);
  }

  const riskByFile = new Map<string, RiskScore>();
  for (const cf of cappedFiles) {
    if (cf.status === "D") continue;
    const symbols = symbolsByFile.get(cf.path) || [];

    // Tested? Try sibling test names + same-file basename match in index
    const tested = (() => {
      for (const cand of candidateTestNames(cf.path)) {
        if (testFilesByBasename.has(cand)) return true;
      }
      // Also: any importer that is itself a test file
      const indexed = fileCache.get(cf.path);
      if (indexed) {
        for (const edge of indexer.graphStore.getImporters(indexed.id)) {
          const importerPath = Array.from(fileCache.values()).find(
            (f) => f.id === edge.source_file_id
          )?.path;
          if (importerPath && isTestPath(importerPath)) return true;
        }
      }
      return false;
    })();

    // Total caller count for changed symbols (cap each lookup so a single
    // symbol with 1000 callers doesn't dominate the score linearly)
    let totalCallers = 0;
    for (const name of symbols) {
      const c = indexer.symbolRefStore.getCallerCount(name);
      totalCallers += Math.min(c, 50);
    }

    const danglingCount = removedSymbols
      .filter((s) => s.file === cf.path)
      .filter((s) => (danglingRefs.get(s.name)?.count ?? 0) > 0).length;

    const importerCount = fileImpact.get(cf.path)?.importers ?? 0;

    const score = computeRiskScore({
      path: cf.path,
      added: cf.added,
      removed: cf.removed,
      isTested: tested,
      importerCount,
      changedSymbolNames: symbols,
      totalCallerCount: totalCallers,
      danglingSymbolCount: danglingCount,
    });
    riskByFile.set(cf.path, score);
  }

  // ─── 6.7. Run structural diff heuristics ───
  // Issue #5: catch unguarded calls inside stream pipelines — the
  // class of bug that symbol-level analysis alone cannot see.
  const diffHunks = getDiffHunks(indexer.rootPath, ref);
  const heuristicFindings: HeuristicFinding[] = runAllHeuristics(diffHunks);

  // ─── 7. Format output with section-level budgeting ───
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

  // Header
  {
    const headerLines: string[] = [];
    headerLines.push(`# Diff Review: \`${ref}\``);
    headerLines.push("");
    headerLines.push(
      `**${changedFiles.length} file${changedFiles.length === 1 ? "" : "s"} changed** ` +
        `(${addedSymbols.length} added, ${removedSymbols.length} removed, ${modifiedFiles.length} modified)`
    );
    if (truncated) {
      headerLines.push(`_Showing first ${maxFiles} files; ${changedFiles.length - maxFiles} more not analyzed._`);
    }
    headerLines.push("");
    if (!addSection(headerLines.join("\n"))) return sections.join("\n");
  }

  // Changed files table
  {
    const cfLines: string[] = [];
    cfLines.push("## Changed files");
    for (const cf of cappedFiles) {
      const indexed = fileCache.get(cf.path);
      const pr = indexed ? ` (PR ${indexed.pagerank.toFixed(2)})` : "";
      const impact = fileImpact.get(cf.path);
      const impactNote = impact && impact.importers > 0 ? ` ← ${impact.importers} importer${impact.importers === 1 ? "" : "s"}` : "";
      const risk = riskByFile.get(cf.path);
      const riskNote = risk ? ` · ${formatRiskBadge(risk)}` : "";
      cfLines.push(`- **${cf.status}** \`${cf.path}\` +${cf.added} -${cf.removed}${pr}${impactNote}${riskNote}`);
    }
    cfLines.push("");
    if (!addSection(cfLines.join("\n"))) return sections.join("\n");
  }

  // Risk hot-list
  const riskRanked = [...riskByFile.entries()]
    .filter(([, r]) => r.level === "high" || r.level === "critical")
    .sort((a, b) => b[1].total - a[1].total);
  if (riskRanked.length > 0) {
    const riskLines: string[] = [];
    riskLines.push("## ⚠️ Highest-risk files");
    riskLines.push("_Risk score combines: untested, security-sensitive paths, fan-in, caller count, dangling refs, churn._");
    for (const [path, score] of riskRanked.slice(0, 8)) {
      riskLines.push(`- ${formatRiskBadge(score)} \`${path}\``);
      if (score.reasons.length > 0) {
        riskLines.push(`  _${score.reasons.join("; ")}_`);
      }
    }
    riskLines.push("");
    if (!addSection(riskLines.join("\n"))) return sections.join("\n");
  }

  // Removed symbols + dangling refs (the most important section for safety)
  if (removedSymbols.length > 0) {
    const remLines: string[] = [];
    remLines.push("## Removed symbols");
    let dangerCount = 0;
    for (const sym of removedSymbols.slice(0, 15)) {
      const refs = danglingRefs.get(sym.name);
      const refCount = refs?.count ?? 0;
      const danger = refCount > 0 ? "⚠️" : "✓";
      const refLabel =
        refCount === 0
          ? "0 dangling refs (safe to remove)"
          : `**${refCount} dangling reference${refCount === 1 ? "" : "s"}** in ${refs!.files.length} file${refs!.files.length === 1 ? "" : "s"}`;
      remLines.push(`- ${danger} \`${sym.name}\` (${sym.type}) @ ${sym.file}:${sym.line} — ${refLabel}`);
      if (refCount > 0) {
        dangerCount++;
        for (const f of refs!.files.slice(0, 3)) {
          remLines.push(`    · ${f}`);
        }
        if (refs!.files.length > 3) {
          remLines.push(`    · ...and ${refs!.files.length - 3} more (call sverklo_impact for full list)`);
        }
      }
    }
    if (dangerCount > 0) {
      remLines.push("");
      remLines.push(`**⚠️ ${dangerCount} removed symbol${dangerCount === 1 ? " has" : "s have"} remaining references — review carefully.**`);
    }
    remLines.push("");
    if (!addSection(remLines.join("\n"))) return sections.join("\n");
  }

  // Added symbols + duplication warnings
  if (addedSymbols.length > 0) {
    const addLines: string[] = [];
    addLines.push("## Added symbols");
    for (const sym of addedSymbols.slice(0, 15)) {
      addLines.push(`- \`${sym.name}\` (${sym.type}) @ ${sym.file}:${sym.line}`);
    }
    if (addedSymbols.length > 15) {
      addLines.push(`  _...and ${addedSymbols.length - 15} more_`);
    }
    addLines.push("");

    if (duplicateCandidates.length > 0) {
      addLines.push("### ⚠️ Possible duplicates");
      for (const dup of duplicateCandidates) {
        addLines.push(`- **${dup.added.name}** added in \`${dup.added.file}\` — already exists in:`);
        for (const s of dup.similar.slice(0, 3)) {
          addLines.push(`    · ${s.file}:${s.line}`);
        }
      }
      addLines.push("");
    }
    if (!addSection(addLines.join("\n"))) return sections.join("\n");
  }

  // Modified files with high impact (> 3 importers)
  const highImpactFiles = Array.from(fileImpact.entries())
    .filter(([, v]) => v.importers >= 3)
    .sort((a, b) => b[1].importers - a[1].importers);
  if (highImpactFiles.length > 0) {
    const hiLines: string[] = [];
    hiLines.push("## High-impact modifications");
    hiLines.push("_These files are imported by many others — changes cascade widely._");
    for (const [path, impact] of highImpactFiles.slice(0, 10)) {
      hiLines.push(`- \`${path}\` ← ${impact.importers} importer${impact.importers === 1 ? "" : "s"}`);
    }
    hiLines.push("");
    if (!addSection(hiLines.join("\n"))) return sections.join("\n");
  }

  // Structural heuristic findings (unguarded stream calls, etc.)
  if (heuristicFindings.length > 0) {
    const hLines: string[] = [];
    hLines.push("## ⚠️ Structural warnings");
    hLines.push(
      "_These are heuristic matches over the diff text. Some may be false positives; " +
        "each finding carries a short explanation so you can triage quickly._"
    );
    const grouped = new Map<string, HeuristicFinding[]>();
    for (const f of heuristicFindings) {
      const arr = grouped.get(f.heuristic) || [];
      arr.push(f);
      grouped.set(f.heuristic, arr);
    }
    for (const [heuristic, findings] of grouped) {
      hLines.push(`### ${heuristic} (${findings.length})`);
      for (const f of findings.slice(0, 6)) {
        const badge = f.severity === "high" ? "🔴" : f.severity === "medium" ? "🟡" : "🟢";
        hLines.push(`- ${badge} \`${f.file}:${f.line}\` — ${f.message}`);
        hLines.push(`    \`${f.snippet}\``);
      }
      if (findings.length > 6) {
        hLines.push(`  _...and ${findings.length - 6} more_`);
      }
    }
    hLines.push("");
    if (!addSection(hLines.join("\n"))) return sections.join("\n");
  }

  // Recommendations
  {
    const recLines: string[] = [];
    recLines.push("## Suggested next checks");
    if (removedSymbols.length > 0) {
      const dangerNames = removedSymbols
        .filter((s) => (danglingRefs.get(s.name)?.count ?? 0) > 0)
        .map((s) => s.name);
      if (dangerNames.length > 0) {
        recLines.push(`- Run \`sverklo_impact symbol:"${dangerNames[0]}"\` to see all callers of removed symbols`);
      }
    }
    if (modifiedFiles.length > 0) {
      recLines.push(`- Run \`sverklo_diff_search query:"..."\` to search semantically within these files`);
    }
    if (addedSymbols.length > 0 && duplicateCandidates.length === 0) {
      recLines.push(`- New symbols look unique — no duplication detected against indexed code`);
    }
    recLines.push(`- For exact-match checks, fall back to \`grep -r 'symbol' .\``);
    addSection(recLines.join("\n"));
  }

  return sections.join("\n");
}

// ─── git helpers ───

function getChangedFiles(rootPath: string, ref: string): ChangedFile[] | null {
  try {
    // Use --diff-filter=ACDMRT and --numstat to get type + line counts
    const numstatResult = spawnSync(
      "git", ["diff", "--numstat", "--diff-filter=ACDMRT", ref],
      { cwd: rootPath, encoding: "utf-8", timeout: 8000, maxBuffer: 5 * 1024 * 1024 }
    );
    if (numstatResult.error) throw numstatResult.error;
    if (numstatResult.status !== 0) throw new Error(numstatResult.stderr || `git exited with ${numstatResult.status}`);
    const out = numstatResult.stdout;

    // Also need status (A/M/D/R)
    const statusResult = spawnSync(
      "git", ["diff", "--name-status", "--diff-filter=ACDMRT", ref],
      { cwd: rootPath, encoding: "utf-8", timeout: 8000, maxBuffer: 5 * 1024 * 1024 }
    );
    if (statusResult.error) throw statusResult.error;
    if (statusResult.status !== 0) throw new Error(statusResult.stderr || `git exited with ${statusResult.status}`);
    const statusOut = statusResult.stdout;

    const statusByPath = new Map<string, string>();
    for (const line of statusOut.trim().split("\n")) {
      if (!line.trim()) continue;
      const [status, ...pathParts] = line.split("\t");
      const path = pathParts[pathParts.length - 1]; // handle renames (R old new)
      statusByPath.set(path, status[0] || "M");
    }

    const files: ChangedFile[] = [];
    for (const line of out.trim().split("\n")) {
      if (!line.trim()) continue;
      const parts = line.split("\t");
      if (parts.length < 3) continue;
      const added = parseInt(parts[0], 10) || 0;
      const removed = parseInt(parts[1], 10) || 0;
      const path = parts[parts.length - 1];
      const status = (statusByPath.get(path) || "M") as ChangedFile["status"];
      files.push({ path, status, added, removed });
    }
    return files;
  } catch (err) {
    return null;
  }
}

interface OldSymbol {
  name: string;
  type: string;
  line: number;
  signature?: string;
}

/**
 * Get the symbols from a file at the "before" state of the diff.
 * For ref like "main..HEAD", we want the file at `main`.
 * For ref like "HEAD~1..HEAD", we want the file at `HEAD~1`.
 *
 * Uses git show to retrieve old content, then runs sverklo's parser on it.
 */
function getOldSymbols(rootPath: string, ref: string, filePath: string): OldSymbol[] {
  // Extract the "from" ref. For "A..B" use A. For "A...B" use A. For bare "B" use B^.
  let fromRef = ref;
  if (ref.includes("...")) fromRef = ref.split("...")[0];
  else if (ref.includes("..")) fromRef = ref.split("..")[0];
  else fromRef = ref + "^";

  if (!fromRef.trim() || fromRef === "^") fromRef = "HEAD^";

  let oldContent: string;
  try {
    const showResult = spawnSync("git", ["show", `${fromRef}:${filePath}`], {
      cwd: rootPath,
      encoding: "utf-8",
      timeout: 5000,
      maxBuffer: 5 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (showResult.error) throw showResult.error;
    if (showResult.status !== 0) throw new Error("git show failed");
    oldContent = showResult.stdout;
  } catch {
    // File didn't exist at the old ref → all symbols are added (caller handles)
    return [];
  }

  // Determine language from file extension
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const langMap: Record<string, string> = {
    ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
    js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
    py: "python", pyi: "python",
    go: "go", rs: "rust", java: "java",
    c: "c", h: "c", cpp: "cpp", cc: "cpp", hpp: "cpp", hh: "cpp",
    rb: "ruby", php: "php",
    kt: "kotlin", kts: "kotlin",
    scala: "scala", swift: "swift", dart: "dart",
    ex: "elixir", exs: "elixir", lua: "lua", zig: "zig",
    hs: "haskell", clj: "clojure", ml: "ocaml",
  };
  const language = langMap[ext];
  if (!language) return [];

  // Use sverklo's existing parser
  // Note: this is a sync import which is fine inside the handler since it's already loaded
  // by other tools. Avoid top-level import to keep this file isolated for testing.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  // We can't actually require here (ESM) — caller must pass parser.
  // Workaround: use a quick regex extraction for the most common cases.
  return quickExtractSymbols(oldContent, language);
}

/**
 * Lightweight symbol extractor for old-file content.
 * We can't import sverklo's full parser here without circular deps,
 * but for diff review we only need names + line numbers, not full chunks.
 */
function quickExtractSymbols(content: string, language: string): OldSymbol[] {
  const symbols: OldSymbol[] = [];
  const lines = content.split("\n");

  // Patterns by language family — covers ~80% of definitions
  const patterns: { regex: RegExp; type: string }[] = [];

  if (language === "typescript" || language === "javascript") {
    patterns.push(
      { regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/, type: "function" },
      { regex: /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/, type: "class" },
      { regex: /^(?:export\s+)?interface\s+(\w+)/, type: "interface" },
      { regex: /^(?:export\s+)?type\s+(\w+)/, type: "type" },
      { regex: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/, type: "function" }
    );
  } else if (language === "python") {
    patterns.push(
      { regex: /^(?:async\s+)?def\s+(\w+)/, type: "function" },
      { regex: /^class\s+(\w+)/, type: "class" }
    );
  } else if (language === "go") {
    patterns.push(
      { regex: /^func\s+(?:\([^)]+\)\s+)?(\w+)/, type: "function" },
      { regex: /^type\s+(\w+)\s+struct/, type: "type" },
      { regex: /^type\s+(\w+)\s+interface/, type: "interface" }
    );
  } else if (language === "rust") {
    patterns.push(
      { regex: /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/, type: "function" },
      { regex: /^(?:pub\s+)?struct\s+(\w+)/, type: "type" },
      { regex: /^(?:pub\s+)?enum\s+(\w+)/, type: "type" },
      { regex: /^(?:pub\s+)?trait\s+(\w+)/, type: "interface" }
    );
  } else if (language === "java" || language === "kotlin") {
    patterns.push(
      { regex: /(?:public|private|protected|static|\s)*class\s+(\w+)/, type: "class" },
      { regex: /(?:public|private|protected|static|\s)*interface\s+(\w+)/, type: "interface" },
      { regex: /(?:public|private|protected|static|\s)+\w+(?:<[^>]+>)?\s+(\w+)\s*\(/, type: "method" }
    );
  } else if (language === "ruby") {
    patterns.push(
      { regex: /^\s*def\s+(\w+[!?=]?)/, type: "function" },
      { regex: /^\s*class\s+(\w+)/, type: "class" },
      { regex: /^\s*module\s+(\w+)/, type: "module" }
    );
  } else if (language === "php") {
    patterns.push(
      { regex: /(?:public|private|protected|static|\s)*function\s+(\w+)/, type: "function" },
      { regex: /^(?:abstract\s+)?class\s+(\w+)/, type: "class" }
    );
  }

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    for (const { regex, type } of patterns) {
      const m = trimmed.match(regex);
      if (m) {
        symbols.push({
          name: m[1],
          type,
          line: i + 1,
          signature: trimmed.slice(0, 200),
        });
        break;
      }
    }
  }

  return symbols;
}

import { execSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
import type { Indexer } from "../../indexer/indexer.js";
import { isTestPath, candidateTestNames } from "./test-paths.js";
import { computeRiskScore, formatRiskBadge } from "./risk-score.js";

export const testMapTool = {
  name: "sverklo_test_map",
  description:
    "Map a git diff to its test coverage. Given a ref/range, lists which tests likely cover " +
    "each changed source file (via name heuristics + import graph), flags changed source files " +
    "with NO matching tests, and shows which test files were modified in the diff. Use this " +
    "during MR/PR review to answer 'what tests should I run?' and 'is this change tested?' " +
    "without grepping the whole repo. Coverage is heuristic — sverklo doesn't run code, so " +
    "treat results as candidates, not ground truth.",
  inputSchema: {
    type: "object" as const,
    properties: {
      ref: {
        type: "string",
        description: "Git ref or range. Default: main..HEAD",
      },
      include_importers: {
        type: "boolean",
        description:
          "Also surface test files that import the changed file via the dependency graph (not just name matches). Default: true.",
      },
    },
  },
};

export function handleTestMap(
  indexer: Indexer,
  args: Record<string, unknown>
): string {
  const ref = (args.ref as string) || "main..HEAD";
  const includeImporters = args.include_importers !== false;

  // 1. Get changed files from git diff
  let changedPaths: string[];
  try {
    const out = execSync(
      `git diff --name-only --diff-filter=ACMRT ${ref}`,
      { cwd: indexer.rootPath, encoding: "utf-8", timeout: 8000, maxBuffer: 5 * 1024 * 1024 }
    );
    changedPaths = out.trim().split("\n").filter(Boolean);
  } catch {
    return `Error: not a git repository or invalid ref \`${ref}\`. Try \`sverklo_test_map ref:"HEAD~1..HEAD"\`.`;
  }

  if (changedPaths.length === 0) {
    return `No file changes between \`${ref}\`.`;
  }

  // 2. Partition into source vs test files
  const changedTests: string[] = [];
  const changedSources: string[] = [];
  for (const p of changedPaths) {
    if (isTestPath(p)) changedTests.push(p);
    else changedSources.push(p);
  }

  // 3. Build a quick lookup of all known test files in the index
  const allFiles = indexer.fileStore.getAll();
  const testFiles = allFiles.filter((f) => isTestPath(f.path));
  const testFilesByBasename = new Map<string, string[]>();
  for (const tf of testFiles) {
    const b = basename(tf.path);
    const list = testFilesByBasename.get(b) || [];
    list.push(tf.path);
    testFilesByBasename.set(b, list);
  }

  // 4. Build file id ↔ path maps for graph lookups
  const idToPath = new Map<number, string>();
  const pathToId = new Map<string, number>();
  for (const f of allFiles) {
    idToPath.set(f.id, f.path);
    pathToId.set(f.path, f.id);
  }

  // 5. For each changed source file, find covering test candidates
  type Coverage = {
    source: string;
    nameMatches: string[];
    importerTests: string[];
  };
  const coverage: Coverage[] = [];
  const uncovered: string[] = [];

  for (const src of changedSources) {
    const nameMatches = new Set<string>();

    // Heuristic 1: conventional test filenames anywhere in the index
    for (const cand of candidateTestNames(src)) {
      const hits = testFilesByBasename.get(cand);
      if (hits) hits.forEach((h) => nameMatches.add(h));
    }

    // Heuristic 2: same-directory test file (rare but possible)
    const dir = dirname(src);
    for (const cand of candidateTestNames(src)) {
      const sibling = join(dir, cand);
      if (pathToId.has(sibling)) nameMatches.add(sibling);
    }

    // Heuristic 3: dependency-graph importers that happen to be test files
    const importerTests = new Set<string>();
    if (includeImporters) {
      const id = pathToId.get(src);
      if (id !== undefined) {
        for (const edge of indexer.graphStore.getImporters(id)) {
          const importerPath = idToPath.get(edge.source_file_id);
          if (importerPath && isTestPath(importerPath)) {
            importerTests.add(importerPath);
          }
        }
      }
    }

    // Subtract name matches from importer matches to avoid double-listing
    for (const nm of nameMatches) importerTests.delete(nm);

    if (nameMatches.size === 0 && importerTests.size === 0) {
      uncovered.push(src);
    } else {
      coverage.push({
        source: src,
        nameMatches: [...nameMatches].sort(),
        importerTests: [...importerTests].sort(),
      });
    }
  }

  // 6. Format output
  const lines: string[] = [];
  lines.push(`# Test map for \`${ref}\``);
  lines.push(
    `${changedSources.length} source file${changedSources.length === 1 ? "" : "s"} changed · ` +
      `${changedTests.length} test file${changedTests.length === 1 ? "" : "s"} changed · ` +
      `${coverage.length} covered · ${uncovered.length} uncovered`
  );
  lines.push("");

  if (changedTests.length > 0) {
    lines.push(`## Test files modified in this diff (${changedTests.length})`);
    lines.push(`These run as part of the change itself — make sure they pass.`);
    for (const t of changedTests) lines.push(`- ${t}`);
    lines.push("");
  }

  if (coverage.length > 0) {
    lines.push(`## Likely test coverage (${coverage.length})`);
    lines.push(`_Heuristic — based on filename conventions and import graph, not actual coverage data._`);
    for (const c of coverage) {
      lines.push(`- **${c.source}**`);
      for (const t of c.nameMatches) lines.push(`  - ${t}  _(name match)_`);
      for (const t of c.importerTests) lines.push(`  - ${t}  _(imports source)_`);
    }
    lines.push("");
  }

  if (uncovered.length > 0) {
    lines.push(`## ⚠️ No matching tests found (${uncovered.length})`);
    lines.push(`These changed files have no test file matching by name or import. They may be untested, ` +
      `tested via integration/e2e suites sverklo can't see, or covered by tests outside the indexed paths.`);
    // Compute a risk score for each uncovered file so the reviewer sees
    // *which* untested files are actually dangerous (e.g. auth code with
    // many importers) vs benign (e.g. a typo in a doc snippet).
    const uncoveredScored = uncovered.map((u) => {
      const id = pathToId.get(u);
      const importerCount = id !== undefined
        ? indexer.graphStore.getImporters(id).length
        : 0;
      const symbols = id !== undefined
        ? indexer.chunkStore.getByFile(id).filter((c) => c.name).map((c) => c.name!)
        : [];
      let totalCallers = 0;
      for (const name of symbols) {
        totalCallers += Math.min(indexer.symbolRefStore.getCallerCount(name), 50);
      }
      const score = computeRiskScore({
        path: u,
        added: 0,
        removed: 0,
        isTested: false,
        importerCount,
        changedSymbolNames: symbols,
        totalCallerCount: totalCallers,
        danglingSymbolCount: 0,
      });
      return { path: u, score };
    });
    uncoveredScored.sort((a, b) => b.score.total - a.score.total);
    for (const { path: u, score } of uncoveredScored) {
      lines.push(`- ${formatRiskBadge(score)} ${u}`);
      if (score.reasons.length > 0) {
        lines.push(`  _${score.reasons.filter((r) => r !== "no matching tests").join("; ") || "no matching tests"}_`);
      }
    }
    lines.push("");
  }

  // Suggested next-step commands the reviewer can paste
  if (coverage.length > 0 || changedTests.length > 0) {
    const allTests = new Set<string>();
    changedTests.forEach((t) => allTests.add(t));
    for (const c of coverage) {
      c.nameMatches.forEach((t) => allTests.add(t));
      c.importerTests.forEach((t) => allTests.add(t));
    }
    if (allTests.size > 0 && allTests.size <= 30) {
      lines.push(`## Suggested test selection`);
      lines.push("```");
      lines.push([...allTests].sort().join(" "));
      lines.push("```");
    }
  }

  return lines.join("\n");
}

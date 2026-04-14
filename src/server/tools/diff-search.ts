import { spawnSync } from "node:child_process";
import type { Indexer } from "../../indexer/indexer.js";
import { hybridSearch, formatResults } from "../../search/hybrid-search.js";
import type { ChunkType } from "../../types/index.js";
import { resolveBudget } from "../../utils/budget.js";
import { validateGitRef } from "../../utils/git-validation.js";

export const diffSearchTool = {
  name: "sverklo_diff_search",
  description:
    "Semantic search scoped to files in a git diff (and optionally their dependency closure). " +
    "Use this when reviewing an MR/PR and you need to find code related to a query — but only " +
    "within the changed files, not the entire codebase. Cuts noise from global search and lets " +
    "you ask questions like 'find all lock acquisitions in the changed files' or 'where do " +
    "these new functions get called from existing code'.",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "Natural language query or code pattern",
      },
      ref: {
        type: "string",
        description: "Git ref or range. Default: main..HEAD",
      },
      include_callers: {
        type: "number",
        description:
          "Also include files that import the changed files, N hops out. Default: 0 (only changed files). Use 1 to include direct callers, 2 for transitive.",
      },
      token_budget: {
        type: "number",
        description: "Max tokens to return. Default: 3000.",
      },
      type: {
        type: "string",
        enum: ["function", "class", "type", "interface", "method", "any"],
        description: "Filter by symbol type",
      },
    },
    required: ["query"],
  },
};

export async function handleDiffSearch(
  indexer: Indexer,
  args: Record<string, unknown>
): Promise<string> {
  const query = args.query as string;
  const ref = (args.ref as string) || "main..HEAD";
  const includeCallers = (args.include_callers as number) || 0;
  const tokenBudget = resolveBudget(args, "diff_search", null, 3000);
  const type = (args.type as ChunkType | "any") || "any";

  if (!query) return "Error: query required";
  if (!validateGitRef(ref)) {
    return `Error: invalid git ref \`${ref}\`. Ref must match a safe refspec pattern (no shell metacharacters).`;
  }

  // Get changed files from git diff
  let changedPaths: string[];
  try {
    const result = spawnSync("git", ["diff", "--name-only", "--diff-filter=ACMRT", ref], {
      cwd: indexer.rootPath, encoding: "utf-8", timeout: 8000, maxBuffer: 5 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || `git exited with ${result.status}`);
    const out = result.stdout;
    changedPaths = out.trim().split("\n").filter(Boolean);
  } catch {
    return `Error: not a git repository or invalid ref \`${ref}\`. Try \`sverklo_diff_search query:"..." ref:"HEAD~1..HEAD"\`.`;
  }

  if (changedPaths.length === 0) {
    return `No file changes between \`${ref}\`. Working tree clean.`;
  }

  // Build allowlist of paths
  const allowed = new Set<string>(changedPaths);

  // Optionally expand by importer hops
  if (includeCallers > 0) {
    const fileMap = new Map(indexer.fileStore.getAll().map((f) => [f.path, f.id]));
    let frontier = new Set<number>();
    for (const p of changedPaths) {
      const id = fileMap.get(p);
      if (id !== undefined) frontier.add(id);
    }
    for (let hop = 0; hop < includeCallers; hop++) {
      const nextFrontier = new Set<number>();
      for (const fileId of frontier) {
        const importers = indexer.graphStore.getImporters(fileId);
        for (const imp of importers) {
          nextFrontier.add(imp.source_file_id);
        }
      }
      // Map back to paths and add to allowed
      const idToPath = new Map(indexer.fileStore.getAll().map((f) => [f.id, f.path]));
      for (const id of nextFrontier) {
        const path = idToPath.get(id);
        if (path) allowed.add(path);
      }
      frontier = nextFrontier;
      if (frontier.size === 0) break;
    }
  }

  // Run hybrid search with no scope filter (we'll filter results ourselves)
  const allResults = await hybridSearch(indexer, {
    query,
    tokenBudget: tokenBudget * 2, // grab more, we'll filter down
    type,
  });

  // Filter to allowed paths
  const filtered = allResults.filter((r) => allowed.has(r.file.path));

  // Re-pack to fit budget
  const packed: typeof filtered = [];
  let remaining = tokenBudget;
  for (const r of filtered) {
    const cost = r.chunk.token_count + 30;
    if (cost > remaining) break;
    packed.push(r);
    remaining -= cost;
  }

  if (packed.length === 0) {
    const expandHint =
      includeCallers === 0
        ? " Try `include_callers: 1` to also search files that import the changed files."
        : "";
    return (
      `No results in ${changedPaths.length} changed file${changedPaths.length === 1 ? "" : "s"}` +
      (includeCallers > 0 ? ` (+ ${includeCallers}-hop importer closure)` : "") +
      ` for query \`${query}\`.${expandHint}`
    );
  }

  // Format with diff-context header
  const header = `## Diff search: \`${query}\`\nScope: ${changedPaths.length} changed file${changedPaths.length === 1 ? "" : "s"}` +
    (includeCallers > 0 ? ` + ${allowed.size - changedPaths.length} importer closure files` : "") +
    ` · ${packed.length} result${packed.length === 1 ? "" : "s"}\n`;

  return header + "\n" + formatResults(packed);
}

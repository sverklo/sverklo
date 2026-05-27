import type { IndexFiles } from "../../indexer/index-files.js";
import { formatOverview, type OverviewEntry } from "../../search/token-budget.js";
import { resolveBudget } from "../../utils/budget.js";
import { isVendoredPath } from "../audit-analysis.js";

export const overviewTool = {
  name: "overview",
  description:
    "Get a structural map of the codebase. Shows the most important files and their key symbols ranked by dependency importance (PageRank). Use this FIRST when starting work on an unfamiliar codebase or directory.",
  inputSchema: {
    type: "object" as const,
    properties: {
      path: {
        type: "string",
        description: "Directory to overview (default: project root)",
      },
      token_budget: {
        type: "number",
        description: "Max tokens to return (default: 3000)",
      },
      depth: {
        type: "number",
        description:
          "Progressive disclosure: 1 = directories only, 2 = directories + filenames, " +
          "3 (default) = directories + files + top symbols, 4 = include all named exports. " +
          "Borrowed from iwe-org/iwe's `squash`/`tree` pattern. Lower depth costs fewer " +
          "tokens — use the cheapest depth that still answers the question.",
      },
    },
  },
};

export function handleOverview(
  indexer: IndexFiles,
  args: Record<string, unknown>
): string {
  // Normalize the path param: accept "src", "src/", or "./src". Drops
  // trailing slash, strips leading "./". Without normalization, a user
  // passing "src/" would match files where the prefix happens to
  // include a slash but miss files starting at the bare directory
  // name. Dogfood T4 fix per architectural review 2026-05-13.
  const rawPath = args.path as string | undefined;
  const path = rawPath
    ? rawPath.replace(/^\.\/+/, "").replace(/\/+$/, "")
    : undefined;
  const tokenBudget = resolveBudget(args, "overview", null, 3000);

  const files = indexer.fileStore.getAll(); // already sorted by pagerank DESC

  const entries: OverviewEntry[] = [];
  for (const file of files) {
    // Skip vendored / cached / generated paths so the overview reflects
    // the user's own code, not third-party deps. Same exclusion as
    // audit (Dogfood T1 / T4 in the same review pass).
    if (isVendoredPath(file.path)) continue;
    if (path) {
      // Match `path` against `file.path` in three positions:
      //   1. exact match:       file.path === "src"
      //   2. prefix:            file.path starts with "src/"
      //   3. embedded segment:  file.path contains "/src/"
      //
      // The embedded form handles multi-repo MCP mode where the
      // global registry stores files as "<repo>/src/foo.ts" — without
      // it, `overview path:"src"` returns empty when the
      // server is bound to the parent of the project (the multi-repo
      // workspace shape). Dogfood review 2026-05-14 (Issue C) caught
      // this as a regression of the v0.20.24 T4 fix in workspace mode.
      const isMatch =
        file.path === path ||
        file.path.startsWith(path + "/") ||
        file.path.includes("/" + path + "/");
      if (!isMatch) continue;
    }
    const chunks = indexer.chunkStore.getByFile(file.id);
    entries.push({ file, chunks });
  }

  const depth = clampDepth(args.depth);
  return formatOverview(entries, tokenBudget, path, depth);
}

function clampDepth(raw: unknown): 1 | 2 | 3 | 4 {
  const n = typeof raw === "number" ? Math.floor(raw) : 3;
  if (n <= 1) return 1;
  if (n === 2) return 2;
  if (n >= 4) return 4;
  return 3;
}

import type { Indexer } from "../../indexer/indexer.js";
import { formatOverview, type OverviewEntry } from "../../search/token-budget.js";
import { resolveBudget } from "../../utils/budget.js";

export const overviewTool = {
  name: "sverklo_overview",
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
  indexer: Indexer,
  args: Record<string, unknown>
): string {
  const path = args.path as string | undefined;
  const tokenBudget = resolveBudget(args, "overview", null, 3000);

  const files = indexer.fileStore.getAll(); // already sorted by pagerank DESC

  const entries: OverviewEntry[] = [];
  for (const file of files) {
    if (path && !file.path.startsWith(path)) continue;
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

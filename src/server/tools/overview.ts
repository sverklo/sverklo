import type { Indexer } from "../../indexer/indexer.js";
import { formatOverview, type OverviewEntry } from "../../search/token-budget.js";

export const overviewTool = {
  name: "overview",
  description:
    "Get a structural overview of the codebase showing the most important files and their key symbols (functions, classes, types), ranked by structural importance (PageRank).",
  inputSchema: {
    type: "object" as const,
    properties: {
      path: {
        type: "string",
        description: "Directory to overview (default: project root)",
      },
      token_budget: {
        type: "number",
        description: "Max tokens to return (default: 4000)",
      },
    },
  },
};

export function handleOverview(
  indexer: Indexer,
  args: Record<string, unknown>
): string {
  const path = args.path as string | undefined;
  const tokenBudget = (args.token_budget as number) || 4000;

  const files = indexer.fileStore.getAll(); // already sorted by pagerank DESC

  const entries: OverviewEntry[] = [];
  for (const file of files) {
    if (path && !file.path.startsWith(path)) continue;
    const chunks = indexer.chunkStore.getByFile(file.id);
    entries.push({ file, chunks });
  }

  return formatOverview(entries, tokenBudget, path);
}

import type { Indexer } from "../../indexer/indexer.js";

export const indexStatusTool = {
  name: "index_status",
  description:
    "Check the status of the codebase index. Shows whether indexing is complete, how many files are indexed, and when the index was last updated.",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
};

export function handleIndexStatus(indexer: Indexer): string {
  const status = indexer.getStatus();

  const parts = [
    `Project: ${status.projectName}`,
    `Root: ${status.rootPath}`,
    `Files indexed: ${status.fileCount}`,
    `Code chunks: ${status.chunkCount}`,
    `Languages: ${status.languages.join(", ") || "none"}`,
    `Status: ${status.indexing ? `indexing (${status.progress?.done}/${status.progress?.total})` : "ready"}`,
  ];

  return parts.join("\n");
}

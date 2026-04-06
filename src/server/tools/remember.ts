import type { Indexer } from "../../indexer/indexer.js";
import { embed } from "../../indexer/embedder.js";
import { getGitState } from "../../memory/git-state.js";
import type { MemoryCategory } from "../../types/index.js";

export const rememberTool = {
  name: "sverklo_remember",
  description:
    "Save a decision, preference, pattern, or important context as a persistent memory. Memories are searchable semantically and linked to the current git state.",
  inputSchema: {
    type: "object" as const,
    properties: {
      content: {
        type: "string",
        description:
          "The memory to save — a decision, preference, pattern, or context",
      },
      category: {
        type: "string",
        enum: ["decision", "preference", "pattern", "context", "todo"],
        description: "Memory category (default: 'context')",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Optional tags, e.g. ['auth', 'api-design']",
      },
      related_files: {
        type: "array",
        items: { type: "string" },
        description:
          "File paths this memory relates to (enables staleness detection)",
      },
      confidence: {
        type: "number",
        description:
          "Confidence level 0.0-1.0 (default: 1.0). Lower for tentative decisions.",
      },
    },
    required: ["content"],
  },
};

export async function handleRemember(
  indexer: Indexer,
  args: Record<string, unknown>
): Promise<string> {
  const content = args.content as string;
  const category = (args.category as MemoryCategory) || "context";
  const tags = (args.tags as string[]) || null;
  const relatedFiles = (args.related_files as string[]) || null;
  const confidence = (args.confidence as number) ?? 1.0;

  const { sha, branch } = getGitState(indexer.rootPath);

  const id = indexer.memoryStore.insert(
    category,
    content,
    tags,
    confidence,
    sha,
    branch,
    relatedFiles
  );

  // Embed the memory for semantic search
  const [vector] = await embed([content]);
  indexer.memoryEmbeddingStore.insert(id, vector);

  const parts = [`Remembered (id: ${id}, category: ${category})`];
  if (sha) parts.push(`git: ${branch || "detached"}@${sha.slice(0, 7)}`);
  if (tags) parts.push(`tags: ${tags.join(", ")}`);
  if (relatedFiles) parts.push(`files: ${relatedFiles.join(", ")}`);

  return parts.join("\n");
}

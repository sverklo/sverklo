import type { Indexer } from "../../indexer/indexer.js";
import { embed, cosineSimilarity } from "../../indexer/embedder.js";
import { getGitState } from "../../memory/git-state.js";
import type { MemoryCategory, MemoryTier } from "../../types/index.js";

const CONFLICT_THRESHOLD = 0.85;

export const rememberTool = {
  name: "sverklo_remember",
  description:
    "Save a decision, preference, pattern, or important context as a persistent memory. " +
    "Memories are searchable semantically and linked to the current git state. " +
    "Automatically detects conflicts with existing memories and invalidates them (bi-temporal — history preserved).",
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
        enum: ["decision", "preference", "pattern", "context", "todo", "procedural"],
        description:
          "Memory category (default: 'context'). Use 'procedural' for 'always do X' rules that decay slowly.",
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
      tier: {
        type: "string",
        enum: ["core", "archive"],
        description:
          "Memory tier. 'core' memories auto-inject into every session (project invariants). 'archive' is searched on demand. Default: archive (procedural/preference auto-promote to core).",
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
  // Procedural defaults to higher confidence (they're "always" rules)
  const defaultConfidence = category === "procedural" ? 0.95 : 1.0;
  const confidence = (args.confidence as number) ?? defaultConfidence;
  // Procedural and preference memories auto-promote to core tier
  const explicitTier = args.tier as MemoryTier | undefined;
  const tier: MemoryTier =
    explicitTier ??
    (category === "procedural" || category === "preference" ? "core" : "archive");

  const { sha, branch } = getGitState(indexer.rootPath);

  // ─── Conflict detection ───
  // Check for existing active memories with high semantic similarity.
  // If same related_files or very high similarity, invalidate the old one.
  const [queryVector] = await embed([content]);
  const existingEmbeddings = indexer.memoryEmbeddingStore.getAll();
  const conflicts: { id: number; similarity: number }[] = [];

  for (const [memId, vec] of existingEmbeddings) {
    const sim = cosineSimilarity(queryVector, vec);
    if (sim >= CONFLICT_THRESHOLD) {
      const existingMem = indexer.memoryStore.getById(memId);
      if (!existingMem) continue;
      // Skip already-invalidated memories
      if (existingMem.valid_until_sha) continue;

      // Same related files OR very high similarity (>0.92) = conflict
      const existingFiles: string[] = existingMem.related_files
        ? JSON.parse(existingMem.related_files)
        : [];
      const sameFiles =
        relatedFiles &&
        existingFiles.some((f) => relatedFiles.includes(f));

      if (sim >= 0.92 || sameFiles) {
        conflicts.push({ id: memId, similarity: sim });
      }
    }
  }

  // Insert new memory
  const id = indexer.memoryStore.insert(
    category,
    content,
    tags,
    confidence,
    sha,
    branch,
    relatedFiles,
    tier
  );

  // Invalidate conflicting memories (bi-temporal — never delete)
  for (const conflict of conflicts) {
    indexer.memoryStore.invalidate(conflict.id, sha, id);
  }

  // Store the new embedding
  indexer.memoryEmbeddingStore.insert(id, queryVector);

  const parts = [`Remembered (id: ${id}, category: ${category}, tier: ${tier})`];
  if (sha) parts.push(`git: ${branch || "detached"}@${sha.slice(0, 7)}`);
  if (tags) parts.push(`tags: ${tags.join(", ")}`);
  if (relatedFiles) parts.push(`files: ${relatedFiles.join(", ")}`);
  if (conflicts.length > 0) {
    parts.push(
      `superseded ${conflicts.length} memor${conflicts.length === 1 ? "y" : "ies"}: ${conflicts.map((c) => `#${c.id} (sim ${c.similarity.toFixed(2)})`).join(", ")}`
    );
  }

  return parts.join("\n");
}

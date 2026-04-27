import type { Indexer } from "../../indexer/indexer.js";
import { getGitState } from "../../memory/git-state.js";
import { track } from "../../telemetry/index.js";
import type { MemoryCategory, MemoryTier, MemoryKind } from "../../types/index.js";
import { validateEnum, requireString } from "./_validation.js";

const CONFLICT_THRESHOLD = 0.85;

export const rememberTool = {
  name: "sverklo_remember",
  description:
    "Save a persistent memory tied to git state. Auto-invalidates conflicting prior memories.",
  inputSchema: {
    type: "object" as const,
    properties: {
      content: { type: "string", description: "The memory to save" },
      category: {
        type: "string",
        enum: ["decision", "preference", "pattern", "context", "todo", "procedural", "correction"],
        description:
          "Default: context. Use procedural for 'always do X' rules. " +
          "Use correction when the user is fixing a prior model mistake " +
          "(\"stop using em-dashes\", \"never call this method again\") " +
          "— mirrors the AI Edge memory taxonomy and the bench:research " +
          "Corrections category in markdown export.",
      },
      tags: { type: "array", items: { type: "string" }, description: "Optional tags" },
      related_files: {
        type: "array",
        items: { type: "string" },
        description: "Files this memory relates to (enables staleness detection)",
      },
      confidence: { type: "number", description: "0.0-1.0, default 1.0" },
      tier: {
        type: "string",
        enum: ["core", "archive"],
        description: "core auto-injects each session, archive is searched on demand",
      },
      kind: {
        type: "string",
        enum: ["episodic", "semantic", "procedural"],
        description:
          "Cognitive-science axis: episodic = a moment-bound event/decision, " +
          "semantic = a timeless fact/rule, procedural = a how-to. Defaults from " +
          "category (procedural→procedural, preference/pattern→semantic, else→episodic).",
      },
      scope: {
        type: "string",
        enum: ["project", "workspace"],
        description:
          "project (default) saves to this repo's memory store. workspace saves " +
          "to a shared store at ~/.sverklo/workspaces/<name>/memories.db, " +
          "discoverable across every other repo in the same workspace. Use " +
          "workspace for cross-repo decisions ('we use Postgres everywhere'); " +
          "use project for repo-specific context.",
      },
    },
    required: ["content"],
  },
};

export async function handleRemember(
  indexer: Indexer,
  args: Record<string, unknown>
): Promise<string> {
  const contentArg = requireString(
    args.content,
    "content",
    'sverklo_remember content:"we picked SQLite for the index" [category:decision] [kind:semantic]'
  );
  if (!contentArg.ok) return contentArg.message;
  const content = contentArg.value;

  const categoryRes = validateEnum(
    args.category,
    ["decision", "preference", "pattern", "context", "todo", "procedural", "correction"] as const,
    "category",
    "context"
  );
  if (categoryRes instanceof Error) return `Error: ${categoryRes.message}`;
  const category: MemoryCategory = categoryRes;

  // kind is optional: when omitted, the store derives it from category.
  // We only validate when the caller explicitly passes a value.
  const ALLOWED_KINDS = ["episodic", "semantic", "procedural"] as const;
  if (
    args.kind !== undefined &&
    args.kind !== null &&
    args.kind !== "" &&
    (typeof args.kind !== "string" || !ALLOWED_KINDS.includes(args.kind as MemoryKind))
  ) {
    return `Error: \`kind\` must be one of: ${ALLOWED_KINDS.join(", ")} (got ${JSON.stringify(args.kind)})`;
  }

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

  // ─── Workspace scope shortcut ───────────────────────────────────────
  // When the agent saves with scope:workspace, route to the shared
  // workspace memory DB instead of the per-project one. We auto-detect
  // the workspace from indexer.rootPath. Conflict detection + bi-
  // temporal invalidation are intentionally skipped here — workspace
  // memories model "what the team agreed on" and conflicts there
  // should be resolved by humans, not by the embedding cosine.
  const scopeArg = args.scope as "project" | "workspace" | undefined;
  if (scopeArg === "workspace") {
    const { findWorkspaceForPath, openWorkspaceMemory, addWorkspaceMemory } =
      await import("../../workspace/memory.js");
    const wsName = findWorkspaceForPath(indexer.rootPath);
    if (!wsName) {
      return (
        `Error: scope:workspace requires this project to be part of a registered ` +
        `workspace. Run \`sverklo workspace init <name> ${indexer.rootPath} ...\` first, ` +
        `or drop scope:workspace to save at the project level instead.`
      );
    }
    const ws = openWorkspaceMemory(wsName);
    try {
      const explicitKind = args.kind as MemoryKind | undefined;
      const id = addWorkspaceMemory(ws, {
        content,
        category,
        kind: explicitKind,
        tags: tags ?? undefined,
      });
      // Embed into the workspace's memory_embeddings so a future workspace
      // recall can vector-rank against it.
      try {
        const [vec] = await indexer.embed([content]);
        ws.memoryEmbeddingStore.insert(id, vec);
      } catch { /* embedding optional — FTS still works */ }
      void track("memory.write");
      return (
        `Remembered in workspace "${wsName}" (id: ${id}, category: ${category}, kind: ${explicitKind ?? "auto"}). ` +
        `Visible to every other repo in this workspace.`
      );
    } finally {
      ws.close();
    }
  }

  // ─── Conflict detection ───
  // Find prior memories above the conflict threshold via the streaming
  // top-K helper. We over-fetch (top 50) instead of materialising the
  // entire embedding map — same answer, constant memory.
  const [queryVector] = await indexer.embed([content]);
  const candidates = indexer.memoryEmbeddingStore.findTopK(
    queryVector,
    50,
    CONFLICT_THRESHOLD
  );
  const conflicts: { id: number; similarity: number }[] = [];

  for (const { memoryId: memId, score: sim } of candidates) {
    const existingMem = indexer.memoryStore.getById(memId);
    if (!existingMem) continue;
    if (existingMem.valid_until_sha) continue;

    // Same related files OR very high similarity (>0.92) = conflict
    const existingFiles: string[] = existingMem.related_files
      ? JSON.parse(existingMem.related_files)
      : [];
    const sameFiles =
      relatedFiles && existingFiles.some((f) => relatedFiles.includes(f));

    if (sim >= 0.92 || sameFiles) {
      conflicts.push({ id: memId, similarity: sim });
    }
  }

  // Insert new memory
  const explicitKind = args.kind as MemoryKind | undefined;
  const id = indexer.memoryStore.insert(
    category,
    content,
    tags,
    confidence,
    sha,
    branch,
    relatedFiles,
    tier,
    explicitKind
  );

  // P2-18: attach the recent tool-call trajectory so future readers can
  // see the retrieval path that led to this memory. Best-effort — failure
  // here must not break the remember.
  try {
    const { trajectoryBuffer } = await import("../trajectory.js");
    const traj = trajectoryBuffer.snapshot(8);
    if (traj.length > 0) {
      indexer.memoryStore.setTrajectory(id, JSON.stringify(traj));
    }
  } catch { /* trajectory column missing (pre-migration) — skip */ }

  // Mirror to the JSONL journal so users can `cat .sverklo/memories.jsonl`
  // or commit it alongside code. Issue #7.
  indexer.memoryJournal.remember({
    id,
    content,
    category,
    tags,
    confidence,
    git_sha: sha,
    git_branch: branch,
    related_files: relatedFiles,
    tier,
  });

  // Invalidate conflicting memories (bi-temporal — never delete)
  for (const conflict of conflicts) {
    indexer.memoryStore.invalidate(conflict.id, sha, id);
    indexer.memoryJournal.invalidate(conflict.id, sha, id);
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

  void track("memory.write");

  return parts.join("\n");
}

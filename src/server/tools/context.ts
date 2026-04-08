// sverklo_context: umbrella "give me everything relevant to this task" tool.
//
// Inspired by code-review-graph's get_minimal_context. Instead of forcing the
// model to chain 5-8 atomic calls (overview → search → lookup → recall → ...)
// for common code-intelligence questions, this returns a single curated
// bundle in one round trip. The model can still drill down with the atomic
// tools afterward — this is the "front door".
//
// detail_level controls how much:
//   minimal — overview header + top 3 search hits + top 2 memories
//   normal  — overview header + top 5 search hits + top 5 memories + symbol table
//   full    — normal + dependency neighbours of top results

import type { Indexer } from "../../indexer/indexer.js";
import { hybridSearch } from "../../search/hybrid-search.js";
import { handleRecall } from "./recall.js";

export const contextTool = {
  name: "sverklo_context",
  description:
    "Umbrella context bundler. Give a task description and get a single curated bundle: " +
    "codebase overview header, semantically relevant code, related symbols, and matching " +
    "saved memories — in one round trip. Use this as the FIRST call when you start working " +
    "on a new task and want to orient quickly. Drill down with the atomic tools (search, " +
    "lookup, refs, recall) only after this.",
  inputSchema: {
    type: "object" as const,
    properties: {
      task: {
        type: "string",
        description:
          "Free-form description of what you're trying to do, e.g. 'add rate limiting to the login endpoint' or 'understand how billing webhooks are processed'.",
      },
      detail_level: {
        type: "string",
        enum: ["minimal", "normal", "full"],
        description:
          "How much to return. minimal=fast/cheap (good for snap orientation); normal=balanced (default); full=adds dependency neighbours.",
      },
      scope: {
        type: "string",
        description: "Optional path prefix to constrain the search (e.g. 'src/api/').",
      },
    },
    required: ["task"],
  },
};

type DetailLevel = "minimal" | "normal" | "full";

export async function handleContext(
  indexer: Indexer,
  args: Record<string, unknown>
): Promise<string> {
  const task = (args.task as string)?.trim();
  if (!task) return "Error: `task` is required.";
  const detail = ((args.detail_level as string) || "normal") as DetailLevel;
  const scope = args.scope as string | undefined;

  const searchLimit = detail === "minimal" ? 3 : detail === "normal" ? 5 : 8;
  const memoryLimit = detail === "minimal" ? 2 : 5;
  const tokenBudget = detail === "minimal" ? 1500 : detail === "normal" ? 3000 : 5000;

  const parts: string[] = [];
  parts.push(`# Context for: ${task}`);
  parts.push(`_detail: ${detail}${scope ? `, scope: ${scope}` : ""}_`);
  parts.push("");

  // ─── 1. Codebase header ────────────────────────────────────────────
  const status = indexer.getStatus();
  parts.push(`## Codebase`);
  parts.push(
    `${status.projectName} · ${status.fileCount} files · ${status.chunkCount} symbols · ${status.languages.slice(0, 4).join(", ") || "—"}`
  );

  // Core memories surface as project invariants — always include them.
  const coreMemories = indexer.memoryStore.getCore(detail === "minimal" ? 3 : 6);
  if (coreMemories.length > 0) {
    parts.push("");
    parts.push("## Project invariants (core memories)");
    for (const m of coreMemories) {
      const stale = m.is_stale ? " [STALE]" : "";
      parts.push(`- [${m.category}]${stale} ${m.content}`);
    }
  }
  parts.push("");

  // ─── 2. Semantically relevant code ─────────────────────────────────
  const searchResults = await hybridSearch(indexer, {
    query: task,
    tokenBudget,
    scope,
    type: "any",
  });
  const topResults = searchResults.slice(0, searchLimit);

  if (topResults.length > 0) {
    parts.push(`## Most relevant code (${topResults.length})`);
    const fileCache = new Map(indexer.fileStore.getAll().map((f) => [f.id, f]));
    for (const r of topResults) {
      const file = fileCache.get(r.chunk.file_id);
      const path = file?.path || "unknown";
      const pr = file ? ` (PR ${file.pagerank.toFixed(2)})` : "";
      const label = r.chunk.name
        ? `${r.chunk.type} **${r.chunk.name}**`
        : `${r.chunk.type}`;
      parts.push(`- ${label} @ \`${path}:${r.chunk.start_line}\`${pr}`);
      if (r.chunk.signature) {
        parts.push(`  \`${r.chunk.signature.slice(0, 120)}\``);
      }
    }
    parts.push("");

    // ─── 3. (full only) Dependency neighbours ────────────────────────
    if (detail === "full") {
      const seen = new Set<number>();
      const neighbours: { from: string; to: string; via: "imports" | "imported-by" }[] = [];
      for (const r of topResults.slice(0, 3)) {
        const fileId = r.chunk.file_id;
        if (seen.has(fileId)) continue;
        seen.add(fileId);
        const file = fileCache.get(fileId);
        if (!file) continue;

        for (const edge of indexer.graphStore.getImports(fileId).slice(0, 4)) {
          const target = fileCache.get(edge.target_file_id);
          if (target) {
            neighbours.push({ from: file.path, to: target.path, via: "imports" });
          }
        }
        for (const edge of indexer.graphStore.getImporters(fileId).slice(0, 4)) {
          const source = fileCache.get(edge.source_file_id);
          if (source) {
            neighbours.push({ from: source.path, to: file.path, via: "imported-by" });
          }
        }
      }
      if (neighbours.length > 0) {
        parts.push(`## Dependency neighbours`);
        for (const n of neighbours) {
          const arrow = n.via === "imports" ? "→" : "←";
          parts.push(`- \`${n.from}\` ${arrow} \`${n.to}\``);
        }
        parts.push("");
      }
    }
  } else {
    parts.push(`_No semantic matches found for "${task}". Try a more specific query, broaden the scope, or check the index status._`);
    parts.push("");
  }

  // ─── 4. Related memories ──────────────────────────────────────────
  // Use the existing recall handler so we get the same RRF + staleness logic.
  // It returns formatted markdown; if it says "No memories found.", skip the section.
  try {
    const recallOut = await handleRecall(indexer, { query: task, limit: memoryLimit });
    if (recallOut && recallOut !== "No memories found.") {
      parts.push(`## Related memories`);
      parts.push(recallOut.trim());
      parts.push("");
    }
  } catch {
    // recall failures shouldn't block the bundle — silently skip
  }

  // ─── 5. Suggested next moves ───────────────────────────────────────
  parts.push("## Suggested next");
  if (topResults.length > 0) {
    const top = topResults[0];
    if (top.chunk.name) {
      parts.push(`- \`sverklo_refs symbol:"${top.chunk.name}"\` to see who uses the most relevant symbol`);
      parts.push(`- \`sverklo_lookup name:"${top.chunk.name}"\` for the full definition`);
    }
  }
  parts.push(`- \`sverklo_search query:"<more specific term>"\` to drill into a sub-area`);
  if (detail !== "full") {
    parts.push(`- Re-run with \`detail_level:"full"\` to also see dependency neighbours`);
  }

  return parts.join("\n");
}

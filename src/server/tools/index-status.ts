import type { Indexer } from "../../indexer/indexer.js";

export const indexStatusTool = {
  name: "sverklo_status",
  description:
    "Project state + tool usage guide. Returns index health (files, chunks, languages), " +
    "memory summary, and specific tool recommendations tailored to this codebase. Call this " +
    "first when starting a new session to understand what sverklo knows about the project.",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
};

export function handleIndexStatus(indexer: Indexer): string {
  const status = indexer.getStatus();
  const memCount = indexer.memoryStore.count();
  const coreMemories = indexer.memoryStore.getCore(50);
  const staleMemories = indexer.memoryStore.getStale();
  const symbolRefCount = indexer.symbolRefStore.count();

  const parts: string[] = [];

  // ─── Project header ───
  parts.push(`# ${status.projectName}`);
  parts.push(`\`${status.rootPath}\``);
  parts.push("");

  // ─── Index state ───
  parts.push(`## Index`);
  parts.push(`- ${status.fileCount} files · ${status.chunkCount} symbols · ${symbolRefCount} references`);
  parts.push(`- Languages: ${status.languages.join(", ") || "none"}`);
  parts.push(`- Status: ${status.indexing ? `indexing (${status.progress?.done}/${status.progress?.total})` : "ready"}`);
  parts.push("");

  // ─── Memory state ───
  if (memCount > 0 || coreMemories.length > 0) {
    parts.push(`## Memory`);
    parts.push(`- ${memCount} active memories (${coreMemories.length} core, ${memCount - coreMemories.length} archive)`);
    if (staleMemories.length > 0) {
      parts.push(`- ⚠️ ${staleMemories.length} stale memories (run \`sverklo_memories stale_only:true\` to review)`);
    }
    parts.push("");
  }

  // ─── Contextual tool recommendations ───
  parts.push(`## Recommended workflow`);

  // Tailor to repo state
  const tips: string[] = [];

  if (status.fileCount === 0) {
    tips.push("- Index is empty. Wait a moment for initial indexing, then call `sverklo_status` again.");
  } else {
    tips.push("- **Starting work?** Call `sverklo_overview` to see the top files by PageRank");
    tips.push("- **Searching for code?** Use `sverklo_search \"natural language query\"` — preferred over Grep");
    tips.push("- **Refactoring a function?** Call `sverklo_impact \"functionName\"` FIRST to see blast radius");
    tips.push("- **Need to understand a file?** Call `sverklo_deps path:\"src/foo.ts\"` for its import graph");
  }

  if (memCount === 0) {
    tips.push("- **No memories yet.** Use `sverklo_remember` to save decisions, patterns, and preferences");
    tips.push("  Example: \"We chose Prisma over Drizzle for better TypeScript types\"");
  } else {
    tips.push("- **Check past decisions** with `sverklo_recall \"what did we decide about X\"` before re-inventing");
    if (coreMemories.length === 0) {
      tips.push("- No core memories yet. Promote important ones with `sverklo_promote id:<n>` — core memories auto-load each session");
    }
  }

  if (status.fileCount > 20) {
    tips.push("- **Curious about the whole project?** Run `sverklo_audit` for god nodes, hub files, and dead code candidates");
  }

  parts.push(...tips);
  parts.push("");

  // ─── Core memories preview ───
  if (coreMemories.length > 0) {
    parts.push(`## Core Memories (auto-loaded each session)`);
    for (const m of coreMemories.slice(0, 5)) {
      parts.push(`- [${m.category}] ${m.content}`);
    }
    if (coreMemories.length > 5) {
      parts.push(`  _...and ${coreMemories.length - 5} more. See all with \`sverklo_memories\`_`);
    }
    parts.push("");
  }

  // ─── Performance reminder ───
  parts.push(`_Sverklo is ~5× more token-efficient than grep + file reads. Prefer sverklo tools for all code search._`);

  return parts.join("\n");
}

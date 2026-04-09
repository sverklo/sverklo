import { statSync } from "node:fs";
import type { Indexer } from "../../indexer/indexer.js";

// Issue #17: the process-start timestamp. Used to detect whether the
// sverklo binary on disk has been updated since this MCP server was
// spawned — i.e. the user ran `npm install -g sverklo@<newer>` but
// the IDE subprocess kept running the old binary. The warning is
// advisory; the tool still works.
const PROCESS_START_MS = Date.now() - Math.round(process.uptime() * 1000);

/**
 * True if the sverklo binary on disk is newer than our process start.
 * Zero network, single stat() call, cached per-session because we
 * check it on every status call.
 */
let cachedStaleCheck: { ts: number; stale: boolean } | null = null;
function isBinaryStale(): boolean {
  const now = Date.now();
  if (cachedStaleCheck && now - cachedStaleCheck.ts < 60_000) {
    return cachedStaleCheck.stale;
  }
  try {
    // process.argv[1] is the running script path — for sverklo this
    // is usually dist/bin/sverklo.js or a symlink target. stat resolves
    // the symlink so we see the actual binary's mtime.
    const binPath = process.argv[1];
    if (!binPath) {
      cachedStaleCheck = { ts: now, stale: false };
      return false;
    }
    const mtime = statSync(binPath).mtimeMs;
    // If the binary was modified after this process started, we're
    // running stale code. Small fudge factor (5s) for clock drift on
    // file systems with low mtime resolution.
    const stale = mtime > PROCESS_START_MS + 5000;
    cachedStaleCheck = { ts: now, stale };
    return stale;
  } catch {
    cachedStaleCheck = { ts: now, stale: false };
    return false;
  }
}

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

  // Issue #17: warn loudly if the user upgraded sverklo on disk but
  // is still running the old binary in this MCP session. Placed at
  // the very top of the output because it changes the user's next
  // action ("restart your IDE").
  if (isBinaryStale()) {
    parts.push(
      "⚠️ **Sverklo binary on disk is newer than the running process.** " +
        "You upgraded sverklo but this MCP server is still running the old code. " +
        "**Restart your IDE** (or the MCP client) to load the new binary."
    );
    parts.push("");
  }

  // ─── Project header ───
  parts.push(`# ${status.projectName}`);
  parts.push(`\`${status.rootPath}\``);
  parts.push("");

  // ─── Index state ───
  parts.push(`## Index`);
  parts.push(`- ${status.fileCount} files · ${status.chunkCount} symbols · ${symbolRefCount} references`);
  parts.push(`- Languages: ${status.languages.join(", ") || "none"}`);
  parts.push(`- Status: ${status.indexing ? `indexing (${status.progress?.done}/${status.progress?.total})` : "ready"}`);
  // Embedding provider: read from the live indexer so the displayed
  // provider reflects what was *actually* selected, not what env vars
  // *asked for*. If the user requested openai but the init failed and
  // we fell back to default, this will correctly show default. Issue #9.
  const requestedProvider = (process.env.SVERKLO_EMBEDDING_PROVIDER || "default").toLowerCase();
  const activeProvider = indexer.embeddingProviderName;
  const activeDims = indexer.embeddingDimensions;
  if (
    requestedProvider !== "default" &&
    requestedProvider !== "bundled" &&
    requestedProvider !== "onnx" &&
    activeProvider === "default"
  ) {
    parts.push(
      `- Embedding provider: ${activeProvider} (${activeDims}d) ⚠️ requested '${requestedProvider}' but fell back — check SVERKLO_DEBUG for details`
    );
  } else {
    parts.push(`- Embedding provider: ${activeProvider} (${activeDims}d)`);
  }

  // Freshness signal — only meaningful once the index has something to compare
  // against. Skip the disk walk entirely on an empty index to avoid scaring
  // the agent with "everything is dirty" noise during initial bootstrap.
  if (status.fileCount > 0 && !status.indexing) {
    const fresh = indexer.getFreshness();
    if (fresh.ageSeconds !== null) {
      parts.push(`- Last full index: ${formatAge(fresh.ageSeconds)} ago`);
    } else {
      parts.push(`- Last full index: unknown (process restarted since last index)`);
    }

    const dirtyCount = fresh.dirtyFiles.length;
    const missingCount = fresh.missingFiles.length;
    if (dirtyCount === 0 && missingCount === 0) {
      parts.push(`- Freshness: ✅ in sync with disk`);
    } else {
      const bits: string[] = [];
      if (dirtyCount > 0) bits.push(`${dirtyCount} dirty`);
      if (missingCount > 0) bits.push(`${missingCount} deleted`);
      parts.push(`- Freshness: ⚠️ ${bits.join(", ")} (file watcher catches up automatically; reads on these may be stale until then)`);
      const preview = fresh.dirtyFiles.slice(0, 5);
      if (preview.length > 0) {
        parts.push(`  Dirty: ${preview.join(", ")}${dirtyCount > preview.length ? `, +${dirtyCount - preview.length} more` : ""}`);
      }
    }
  }
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
  parts.push(`_Use sverklo for exploratory work, refactor blast-radius, and semantic queries. Use Grep/Read for exact-match lookups and focused diff review._`);

  return parts.join("\n");
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

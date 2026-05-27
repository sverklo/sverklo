import { statSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Indexer } from "../../indexer/indexer.js";
import { isToolEnabled } from "../tool-overrides.js";

// Issue #17: the process-start timestamp. Used to detect whether the
// sverklo binary on disk has been updated since this MCP server was
// spawned — i.e. the user ran `npm install -g sverklo@<newer>` but
// the IDE subprocess kept running the old binary. The warning is
// advisory; the tool still works.
const PROCESS_START_MS = Date.now() - Math.round(process.uptime() * 1000);

/**
 * True if the sverklo binary on disk is newer than our process start
 * AND the on-disk version differs from the running version.
 *
 * The mtime-only check used to fire after every `npm run build`, even
 * when the rebuild was a no-op or the version was unchanged — annoying
 * the user on every status call without a real "you should restart"
 * signal. Dogfood review 2026-05-14 (Issue H) flagged this. Now we
 * require BOTH (a) on-disk newer than process start AND (b) on-disk
 * package.json version differs from this process's version. If
 * versions match, the rebuild is a no-op from the user's perspective
 * and the warning would just create noise.
 *
 * Zero network, two stat()s and at most one readFileSync per minute,
 * cached per-session.
 */
let cachedStaleCheck: { ts: number; stale: boolean } | null = null;
let runningVersion: string | null = null;

function readPackageVersion(packageJsonPath: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

function getRunningVersion(): string | null {
  if (runningVersion !== null) return runningVersion;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // dist/src/server/tools/index-status.js → ../../../../package.json
    for (const rel of ["..", "../..", "../../..", "../../../.."]) {
      const candidate = join(here, rel, "package.json");
      const v = readPackageVersion(candidate);
      if (v) {
        runningVersion = v;
        return v;
      }
    }
  } catch {}
  return null;
}

function isBinaryStale(): boolean {
  const now = Date.now();
  if (cachedStaleCheck && now - cachedStaleCheck.ts < 60_000) {
    return cachedStaleCheck.stale;
  }
  try {
    const binPath = process.argv[1];
    if (!binPath) {
      cachedStaleCheck = { ts: now, stale: false };
      return false;
    }
    const mtime = statSync(binPath).mtimeMs;
    const mtimeIsNewer = mtime > PROCESS_START_MS + 5000;
    if (!mtimeIsNewer) {
      cachedStaleCheck = { ts: now, stale: false };
      return false;
    }
    // mtime says rebuilt — but is the VERSION different? Read the
    // on-disk package.json and compare. Same version → user just
    // rebuilt without a release bump; no need to nag them about it.
    const here = dirname(binPath);
    let onDiskVersion: string | null = null;
    for (const rel of ["..", "../..", "../../.."]) {
      const v = readPackageVersion(join(here, rel, "package.json"));
      if (v) { onDiskVersion = v; break; }
    }
    const running = getRunningVersion();
    const stale = onDiskVersion !== null && running !== null && onDiskVersion !== running;
    cachedStaleCheck = { ts: now, stale };
    return stale;
  } catch {
    cachedStaleCheck = { ts: now, stale: false };
    return false;
  }
}

export const indexStatusTool = {
  name: "status",
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
  // is still running the old binary in this MCP session. Suppressed
  // when the on-disk version matches the running version (Dogfood
  // review 2026-05-14, Issue H). Includes both versions so the user
  // sees exactly which upgrade is pending.
  if (isBinaryStale()) {
    const running = getRunningVersion() ?? "unknown";
    parts.push(
      `⚠️ **Sverklo upgraded on disk — restart your IDE.** ` +
        `This process: v${running}. The new binary won't load until the ` +
        `MCP server restarts (close + reopen your IDE).`,
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
      parts.push(`- ⚠️ ${staleMemories.length} stale memories (run \`memories stale_only:true\` to review)`);
    }
    parts.push("");
  }

  // ─── Contextual tool recommendations ───
  parts.push(`## Recommended workflow`);

  // Tailor to repo state
  const tips: string[] = [];

  // Issue #36 (HaleTom 2026-05-13): only recommend tools that are actually
  // exposed in the current profile. The user reported recall being
  // hinted while not loaded under SVERKLO_PROFILE=core — a confidence-
  // erosion bug because the agent then tries a non-existent tool.
  const has = isToolEnabled;

  if (status.fileCount === 0) {
    tips.push("- Index is empty. Wait a moment for initial indexing, then call `status` again.");
  } else {
    if (has("overview"))
      tips.push("- **Starting work?** Call `overview` to see the top files by PageRank");
    if (has("search"))
      tips.push("- **Searching for code?** Use `search \"natural language query\"` — preferred over Grep");
    if (has("impact"))
      tips.push("- **Refactoring a function?** Call `impact \"functionName\"` FIRST to see blast radius");
    if (has("deps"))
      tips.push("- **Need to understand a file?** Call `deps path:\"src/foo.ts\"` for its import graph");
  }

  if (memCount === 0) {
    if (has("remember")) {
      tips.push("- **No memories yet.** Use `remember` to save decisions, patterns, and preferences");
      tips.push("  Example: \"We chose Prisma over Drizzle for better TypeScript types\"");
    }
  } else {
    if (has("recall"))
      tips.push("- **Check past decisions** with `recall \"what did we decide about X\"` before re-inventing");
    if (coreMemories.length === 0 && has("promote")) {
      tips.push("- No core memories yet. Promote important ones with `promote id:<n>` — core memories auto-load each session");
    }
  }

  if (status.fileCount > 20 && has("audit")) {
    tips.push("- **Curious about the whole project?** Run `audit` for god nodes, hub files, and dead code candidates");
  }

  // Inform the user when running on a slim profile so they know WHY
  // certain capabilities aren't in the recommendations.
  const profileName = process.env.SVERKLO_PROFILE?.trim().toLowerCase();
  if (profileName && profileName !== "full") {
    tips.push(
      `- _Running under \`SVERKLO_PROFILE=${profileName}\`. Set \`SVERKLO_PROFILE=full\` (or \`lean\` / \`research\`) for memory, audit, and review tools._`,
    );
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
      parts.push(`  _...and ${coreMemories.length - 5} more. See all with \`memories\`_`);
    }
    parts.push("");
  }

  // ─── Cache observability (Dogfood perf review 2026-05-14) ───
  // Surfaces the FileStore hit-rate so users can verify the v0.20.24
  // snapshot cache is actually working. The agent flagged the
  // observability gap ("cannot directly observe cache hits").
  // Only printed under SVERKLO_DEBUG=1 — too noisy for the default
  // status output, but accessible when investigating perf.
  if (process.env.SVERKLO_DEBUG === "1") {
    const cacheStats = indexer.fileStore.getCacheStats();
    if (cacheStats.hits + cacheStats.misses > 0) {
      parts.push("");
      parts.push(`## Cache stats`);
      parts.push(
        `- FileStore.getAll: ${cacheStats.hits} hits / ${cacheStats.misses} misses ` +
          `(${Math.round(cacheStats.hitRate * 100)}% hit rate)`,
      );
    }
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

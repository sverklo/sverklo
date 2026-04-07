import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Indexer } from "../indexer/indexer.js";
import { startWatcher } from "../indexer/watcher.js";
import { getProjectConfig } from "../utils/config.js";
import { log, logError } from "../utils/logger.js";
import { searchTool, handleSearch } from "./tools/search.js";
import { overviewTool, handleOverview } from "./tools/overview.js";
import { lookupTool, handleLookup } from "./tools/lookup.js";
import {
  findReferencesTool,
  handleFindReferences,
} from "./tools/find-references.js";
import {
  dependenciesTool,
  handleDependencies,
} from "./tools/dependencies.js";
import {
  indexStatusTool,
  handleIndexStatus,
} from "./tools/index-status.js";
import { rememberTool, handleRemember } from "./tools/remember.js";
import { recallTool, handleRecall } from "./tools/recall.js";
import { forgetTool, handleForget } from "./tools/forget.js";
import { memoriesTool, handleMemories } from "./tools/memories.js";
import { astGrepTool, handleAstGrep } from "./tools/ast-grep.js";
import { impactTool, handleImpact } from "./tools/impact.js";
import { auditTool, handleAudit } from "./tools/audit.js";
import { wakeupTool, handleWakeup } from "./tools/wakeup.js";
import {
  promoteTool,
  demoteTool,
  handlePromote,
  handleDemote,
} from "./tools/tier.js";
import { startHttpServer } from "./http-server.js";

// Zilliz claude-context compatibility tool definitions.
// These mirror github.com/zilliztech/claude-context tool names so users can
// swap claude-context for sverklo without changing their MCP client config.
const indexCodebaseTool = {
  name: "index_codebase",
  description:
    "[Zilliz claude-context compat] Index (or re-scan) the current codebase. " +
    "Sverklo indexes automatically on startup and via file watcher; calling this " +
    "triggers a manual rescan. Equivalent to sverklo's built-in indexing.",
  inputSchema: {
    type: "object" as const,
    properties: {
      path: {
        type: "string",
        description: "Ignored — sverklo always indexes the project root configured at startup.",
      },
      force: {
        type: "boolean",
        description: "Ignored — sverklo always uses incremental indexing based on mtime.",
      },
    },
  },
};

const searchCodeTool = {
  name: "search_code",
  description:
    "[Zilliz claude-context compat] Alias for sverklo_search. Semantic + text hybrid " +
    "code search using embeddings and PageRank. Provided for drop-in compatibility " +
    "with the Zilliz claude-context MCP server.",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: { type: "string", description: "Natural language query or code pattern" },
      path: { type: "string", description: "Limit to path prefix (maps to sverklo's `scope`)" },
      limit: { type: "number", description: "Token budget for results (default 4000)" },
    },
    required: ["query"],
  },
};

const clearIndexTool = {
  name: "clear_index",
  description:
    "[Zilliz claude-context compat] Delete the index database and rebuild it from scratch. " +
    "Use when the index is corrupted or you want a fully fresh build.",
  inputSchema: {
    type: "object" as const,
    properties: {
      path: { type: "string", description: "Ignored — clears the active project index." },
    },
  },
};

const getIndexingStatusTool = {
  name: "get_indexing_status",
  description:
    "[Zilliz claude-context compat] Alias for sverklo_status. Returns current indexing " +
    "progress and statistics. Provided for drop-in compatibility with Zilliz claude-context.",
  inputSchema: {
    type: "object" as const,
    properties: {
      path: { type: "string", description: "Ignored — reports on the active project index." },
    },
  },
};

export async function startMcpServer(rootPath: string): Promise<void> {
  const config = getProjectConfig(rootPath);
  const indexer = new Indexer(config);

  // Start indexing in background. Tracked in a mutable holder so clear_index
  // can swap in a fresh promise after wiping the database.
  let indexPromise: Promise<void> = indexer.index().catch((err) => {
    logError("Initial indexing failed", err);
  });

  // Start dashboard HTTP server alongside MCP
  startHttpServer(indexer);

  // Start file watcher
  startWatcher(indexer, rootPath);

  // Read version from package.json so we don't ship a stale string
  let serverVersion = "0.0.0";
  try {
    const { readFileSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    for (const rel of ["..", "../..", "../../.."]) {
      try {
        const pkg = JSON.parse(readFileSync(join(here, rel, "package.json"), "utf-8"));
        if (pkg.name === "sverklo" && pkg.version) {
          serverVersion = pkg.version;
          break;
        }
      } catch {}
    }
  } catch {}

  const server = new Server(
    {
      name: "sverklo",
      version: serverVersion,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
      instructions:
        "Sverklo provides code intelligence for this project. " +
        "ALWAYS prefer sverklo tools over built-in grep/search/file reading:\n" +
        "- Use sverklo_search instead of Grep or ripgrep for code search (faster, semantic, ranked by importance)\n" +
        "- Use sverklo_overview to understand project structure (instead of listing files)\n" +
        "- Use sverklo_lookup to find function/class definitions by name\n" +
        "- Use sverklo_refs to find all references to a symbol\n" +
        "- Use sverklo_deps to understand file dependencies\n" +
        "- Use sverklo_remember to save important decisions, patterns, and preferences\n" +
        "- Use sverklo_recall to check if a decision was already made\n" +
        "These tools use semantic embeddings and PageRank ranking — much more accurate than grep.",
    }
  );

  // Resources — auto-injected context at session start
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: "sverklo://context",
        name: "Sverklo Project Context",
        description:
          "Key memories and codebase overview. Read this at session start to understand the project.",
        mimeType: "text/plain",
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri === "sverklo://context") {
      await indexPromise;

      const parts: string[] = [];

      // Core memories — always-on project invariants (tier='core')
      // These are auto-injected on every session start, not searched.
      const coreMemories = indexer.memoryStore.getCore(15);
      if (coreMemories.length > 0) {
        parts.push("## Core Project Context");
        parts.push("_These are project invariants to always keep in mind:_");
        for (const m of coreMemories) {
          const stale = m.is_stale ? " [STALE]" : "";
          parts.push(`- [${m.category}]${stale} ${m.content}`);
        }
        parts.push("");
      }

      // Fallback: if no core memories yet, show recent archive ones
      if (coreMemories.length === 0) {
        const recent = indexer.memoryStore.getAll(5);
        if (recent.length > 0) {
          parts.push("## Recent Memories");
          for (const m of recent) {
            const stale = m.is_stale ? " [STALE]" : "";
            parts.push(`- [${m.category}]${stale} ${m.content}`);
          }
          parts.push("");
        }
      }

      // Index summary
      const status = indexer.getStatus();
      parts.push(`## Codebase: ${status.projectName}`);
      parts.push(`${status.fileCount} files, ${status.chunkCount} chunks indexed`);
      parts.push(`Languages: ${status.languages.join(", ") || "none"}`);
      parts.push("");
      parts.push("Use sverklo_search for semantic code search (preferred over grep).");
      parts.push("Use sverklo_remember to save important decisions.");

      return {
        contents: [
          {
            uri: "sverklo://context",
            mimeType: "text/plain",
            text: parts.join("\n"),
          },
        ],
      };
    }

    return { contents: [] };
  });

  // List tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      searchTool,
      overviewTool,
      lookupTool,
      findReferencesTool,
      dependenciesTool,
      indexStatusTool,
      rememberTool,
      recallTool,
      forgetTool,
      memoriesTool,
      promoteTool,
      demoteTool,
      impactTool,
      auditTool,
      wakeupTool,
      astGrepTool,
      // Zilliz claude-context compatibility aliases
      indexCodebaseTool,
      searchCodeTool,
      clearIndexTool,
      getIndexingStatusTool,
    ],
  }));

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Ensure index is ready for search operations.
    // Status tools and clear_index don't need to wait — they manage indexing themselves.
    const skipWait =
      name === "sverklo_status" ||
      name === "get_indexing_status" ||
      name === "clear_index" ||
      name === "index_codebase";
    if (!skipWait) {
      await indexPromise;
    }

    try {
      let result: string;

      switch (name) {
        case "sverklo_search":
          result = await handleSearch(indexer, args || {});
          break;
        case "sverklo_overview":
          result = handleOverview(indexer, args || {});
          break;
        case "sverklo_lookup":
          result = handleLookup(indexer, args || {});
          break;
        case "sverklo_refs":
          result = handleFindReferences(indexer, args || {});
          break;
        case "sverklo_deps":
          result = handleDependencies(indexer, args || {});
          break;
        case "sverklo_status":
          result = handleIndexStatus(indexer);
          break;
        case "sverklo_remember":
          result = await handleRemember(indexer, args || {});
          break;
        case "sverklo_recall":
          result = await handleRecall(indexer, args || {});
          break;
        case "sverklo_forget":
          result = handleForget(indexer, args || {});
          break;
        case "sverklo_memories":
          result = handleMemories(indexer, args || {});
          break;
        case "sverklo_ast_grep":
          result = handleAstGrep(indexer, args || {});
          break;
        case "sverklo_impact":
          result = handleImpact(indexer, args || {});
          break;
        case "sverklo_audit":
          result = handleAudit(indexer, args || {});
          break;
        case "sverklo_wakeup":
          result = handleWakeup(indexer, args || {});
          break;
        case "sverklo_promote":
          result = handlePromote(indexer, args || {});
          break;
        case "sverklo_demote":
          result = handleDemote(indexer, args || {});
          break;

        // ── Zilliz claude-context compatibility aliases ──────────────
        case "search_code": {
          // Map claude-context arg names (path, limit) to sverklo's (scope, token_budget)
          const compatArgs: Record<string, unknown> = {
            query: (args as Record<string, unknown>)?.query,
          };
          const a = (args || {}) as Record<string, unknown>;
          if (a.path !== undefined) compatArgs.scope = a.path;
          if (a.limit !== undefined) compatArgs.token_budget = a.limit;
          if (a.scope !== undefined) compatArgs.scope = a.scope;
          if (a.token_budget !== undefined) compatArgs.token_budget = a.token_budget;
          if (a.language !== undefined) compatArgs.language = a.language;
          if (a.type !== undefined) compatArgs.type = a.type;
          result = await handleSearch(indexer, compatArgs);
          break;
        }
        case "get_indexing_status":
          result = handleIndexStatus(indexer);
          break;
        case "index_codebase": {
          // Trigger a (re)scan in the background and return immediately.
          const status = indexer.getStatus();
          if (status.indexing) {
            result =
              `Indexing already in progress: ${status.progress?.done ?? 0}/` +
              `${status.progress?.total ?? 0} files. Use get_indexing_status to monitor.`;
          } else {
            indexPromise = indexer.index().catch((err) => {
              logError("index_codebase: indexing failed", err);
            });
            result =
              `Started indexing ${status.projectName} at ${status.rootPath}. ` +
              `Use get_indexing_status to monitor progress.`;
          }
          break;
        }
        case "clear_index": {
          log("clear_index: wiping index database");
          indexer.clearIndex();
          // Kick off a fresh full reindex in the background
          indexPromise = indexer.index().catch((err) => {
            logError("clear_index: reindex failed", err);
          });
          result =
            "Index database deleted. Reindexing started in the background — " +
            "use get_indexing_status to monitor progress.";
          break;
        }

        default:
          result = `Unknown tool: ${name}`;
      }

      return {
        content: [{ type: "text", text: result }],
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error";
      logError(`Tool ${name} failed`, err);
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  log(`MCP server started for ${rootPath}`);

  // Handle shutdown
  process.on("SIGINT", () => {
    indexer.close();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    indexer.close();
    process.exit(0);
  });
}

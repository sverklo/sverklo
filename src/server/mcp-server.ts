import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ALL_PROMPTS, findPrompt } from "./prompts.js";
import { HintEngine } from "./hints.js";
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
import { reviewDiffTool, handleReviewDiff } from "./tools/review-diff.js";
import { diffSearchTool, handleDiffSearch } from "./tools/diff-search.js";
import { testMapTool, handleTestMap } from "./tools/test-map.js";
import { contextTool, handleContext } from "./tools/context.js";
import {
  promoteTool,
  demoteTool,
  handlePromote,
  handleDemote,
} from "./tools/tier.js";
import { clustersTool, handleClusters } from "./tools/clusters.js";
import { listReposTool, handleListRepos } from "./tools/list-repos.js";
import { IndexerPool } from "../registry/indexer-pool.js";
import { startHttpServer } from "./http-server.js";
import { track } from "../telemetry/index.js";
import { applyToolOverrides } from "./tool-overrides.js";
import { traceStart } from "../utils/trace.js";

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
  const hints = new HintEngine();

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
        prompts: {},
      },
      instructions:
        "Sverklo: code intelligence for this repo. Use it for exploratory search, " +
        "refactor blast-radius, dependency graphs, diff-aware review, and persistent " +
        "memory across sessions. Prefer Grep/Read for exact-string lookups and " +
        "single-file edits.",
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

  // Prompts: workflow templates that show up in IDE pickers (Claude Code,
  // Cursor, Antigravity). These encode the *order* of sverklo tool calls
  // for common code-intelligence tasks — review, pre-merge, onboarding,
  // architecture mapping, and debugging.
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: ALL_PROMPTS.map((p) => ({
      name: p.name,
      description: p.description,
      arguments: p.arguments,
    })),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const prompt = findPrompt(request.params.name);
    if (!prompt) {
      throw new Error(`Unknown prompt: ${request.params.name}`);
    }
    const args = (request.params.arguments || {}) as Record<string, string | undefined>;
    return {
      description: prompt.description,
      messages: [
        {
          role: "user" as const,
          content: { type: "text" as const, text: prompt.build(args) },
        },
      ],
    };
  });

  // List tools. Zilliz claude-context compat aliases are gated behind
  // SVERKLO_ZILLIZ_COMPAT=1 — they pay ~450 tokens of schema overhead on
  // every session and most users don't need them. Dispatch cases below are
  // always wired so opt-in users keep working.
  const enableZilliz = process.env.SVERKLO_ZILLIZ_COMPAT === "1";
  // Tool descriptions and the visible set can be overridden at runtime via
  // SVERKLO_TOOL_<NAME>_DESCRIPTION and SVERKLO_DISABLED_TOOLS env vars.
  // See src/server/tool-overrides.ts for details. This lets power users
  // repurpose or trim the tool surface without forking.
  const baseTools = [
    contextTool,
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
    reviewDiffTool,
    diffSearchTool,
    testMapTool,
    astGrepTool,
    clustersTool,
    ...(enableZilliz
      ? [indexCodebaseTool, searchCodeTool, clearIndexTool, getIndexingStatusTool]
      : []),
  ];
  const visibleTools = applyToolOverrides(baseTools);
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: visibleTools,
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

    // Telemetry: time the dispatch and emit a single tool.call event with
    // outcome + duration. No args, no result content, no error message.
    const __telemetryStart = Date.now();
    let __telemetryOutcome: "ok" | "error" | "timeout" = "ok";

    const trace = traceStart(name, (args || {}) as Record<string, unknown>);

    try {
      let result: string;

      switch (name) {
        case "sverklo_context":
          result = await handleContext(indexer, args || {});
          break;
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
        case "sverklo_review_diff":
          result = handleReviewDiff(indexer, args || {});
          break;
        case "sverklo_diff_search":
          result = await handleDiffSearch(indexer, args || {});
          break;
        case "sverklo_test_map":
          result = handleTestMap(indexer, args || {});
          break;
        case "sverklo_promote":
          result = handlePromote(indexer, args || {});
          break;
        case "sverklo_demote":
          result = handleDemote(indexer, args || {});
          break;
        case "sverklo_clusters":
          result = handleClusters(indexer, args || {});
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

      // Append intent-aware hints unless the caller opts out via env var.
      // Hints are off the critical path of the actual answer — append-only.
      if (process.env.SVERKLO_DISABLE_HINTS !== "1") {
        const argRecord = (args || {}) as Record<string, unknown>;
        hints.record(name, argRecord);
        const hintBlock = hints.buildHint(name, argRecord);
        if (hintBlock) result = result + "\n" + hintBlock;
      }

      // Fire-and-forget telemetry. Only sverklo_* names are tracked
      // (compat aliases like search_code are excluded — they pollute the
      // tool name distribution and we already account for them via the
      // underlying handlers).
      if (name.startsWith("sverklo_")) {
        void track("tool.call", {
          tool: name,
          outcome: __telemetryOutcome,
          duration_ms: Date.now() - __telemetryStart,
        });
      }

      trace.end(result.length);

      return {
        content: [{ type: "text", text: result }],
      };
    } catch (err) {
      __telemetryOutcome = "error";
      trace.error(err);
      if (name.startsWith("sverklo_")) {
        void track("tool.call", {
          tool: name,
          outcome: "error",
          duration_ms: Date.now() - __telemetryStart,
        });
      }
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

// ── Repo property for global (multi-repo) mode ───────────────────────

const repoProperty = {
  type: "string" as const,
  description:
    "Repository name (from sverklo_list_repos). " +
    "Optional if only one repo is indexed.",
};

/**
 * Clone a tool definition and inject an optional `repo` property into its
 * inputSchema. Used in global mode so every tool accepts a repo selector.
 */
function injectRepoParam<T extends { name: string; description: string; inputSchema: { type: string; properties?: Record<string, unknown>; required?: string[] } }>(tool: T): T {
  const schema = { ...tool.inputSchema };
  schema.properties = { ...schema.properties, repo: repoProperty };
  return { ...tool, inputSchema: schema };
}

// ── Global MCP server (multi-repo mode) ──────────────────────────────

export async function startGlobalMcpServer(): Promise<void> {
  const pool = new IndexerPool();
  const hints = new HintEngine();

  // Read version from package.json
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
        prompts: {},
      },
      instructions:
        "Sverklo (global mode): code intelligence serving multiple repos. " +
        "Use sverklo_list_repos to see available repositories, then pass the " +
        "repo name to any tool. If only one repo is registered, the repo " +
        "parameter is optional.",
    }
  );

  // Resources — minimal in global mode
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async () => ({
    contents: [],
  }));

  // Prompts — inject `repo` argument in global mode
  const globalPrompts = ALL_PROMPTS.map((p) => ({
    name: p.name,
    description: p.description,
    arguments: [
      { name: "repo", description: "Repository name (from sverklo_list_repos). Optional if only one repo is indexed.", required: false },
      ...p.arguments,
    ],
  }));

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: globalPrompts,
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const prompt = findPrompt(request.params.name);
    if (!prompt) {
      throw new Error(`Unknown prompt: ${request.params.name}`);
    }
    const args = (request.params.arguments || {}) as Record<string, string | undefined>;
    const repoArg = args.repo;
    let text = prompt.build(args);
    // In global mode, prepend a repo instruction so the agent passes repo to every tool call
    if (repoArg) {
      text = `**Important:** For every sverklo tool call in this workflow, include \`repo:"${repoArg}"\` as a parameter.\n\n${text}`;
    } else {
      const repos = pool.listRepos();
      if (repos.length > 1) {
        text = `**Note:** Multiple repos are indexed (${repos.join(", ")}). Specify \`repo:"<name>"\` in each tool call, or re-run this prompt with the \`repo\` argument.\n\n${text}`;
      }
    }
    return {
      description: prompt.description,
      messages: [
        {
          role: "user" as const,
          content: { type: "text" as const, text },
        },
      ],
    };
  });

  // Build tool list: inject `repo` param into every tool + add list_repos
  const enableZilliz = process.env.SVERKLO_ZILLIZ_COMPAT === "1";
  const baseTools = [
    listReposTool,  // No repo param needed for this one
    injectRepoParam(contextTool),
    injectRepoParam(searchTool),
    injectRepoParam(overviewTool),
    injectRepoParam(lookupTool),
    injectRepoParam(findReferencesTool),
    injectRepoParam(dependenciesTool),
    injectRepoParam(indexStatusTool),
    injectRepoParam(rememberTool),
    injectRepoParam(recallTool),
    injectRepoParam(forgetTool),
    injectRepoParam(memoriesTool),
    injectRepoParam(promoteTool),
    injectRepoParam(demoteTool),
    injectRepoParam(impactTool),
    injectRepoParam(auditTool),
    injectRepoParam(wakeupTool),
    injectRepoParam(reviewDiffTool),
    injectRepoParam(diffSearchTool),
    injectRepoParam(testMapTool),
    injectRepoParam(astGrepTool),
    injectRepoParam(clustersTool),
    ...(enableZilliz
      ? [injectRepoParam(indexCodebaseTool), injectRepoParam(searchCodeTool), injectRepoParam(clearIndexTool), injectRepoParam(getIndexingStatusTool)]
      : []),
  ];
  const visibleTools = applyToolOverrides(baseTools);
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: visibleTools,
  }));

  // Handle tool calls — resolve indexer from pool based on `repo` arg
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // list_repos doesn't need an indexer
    if (name === "sverklo_list_repos") {
      const result = handleListRepos();
      if (process.env.SVERKLO_DISABLE_HINTS !== "1") {
        const argRecord = (args || {}) as Record<string, unknown>;
        hints.record(name, argRecord);
      }
      void track("tool.call", { tool: name, outcome: "ok", duration_ms: 0 });
      return { content: [{ type: "text", text: result }] };
    }

    const repoName = (args as Record<string, unknown> | undefined)?.repo as string | undefined;

    const __telemetryStart = Date.now();
    let __telemetryOutcome: "ok" | "error" | "timeout" = "ok";

    const trace = traceStart(name, (args || {}) as Record<string, unknown>);

    try {
      const indexer = pool.getIndexer(repoName);

      // Wait for index on search-like operations
      const skipWait =
        name === "sverklo_status" ||
        name === "get_indexing_status" ||
        name === "clear_index" ||
        name === "index_codebase";
      if (!skipWait) {
        await pool.waitForIndex(repoName);
      }

      let result: string;

      switch (name) {
        case "sverklo_context":
          result = await handleContext(indexer, args || {});
          break;
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
        case "sverklo_review_diff":
          result = handleReviewDiff(indexer, args || {});
          break;
        case "sverklo_diff_search":
          result = await handleDiffSearch(indexer, args || {});
          break;
        case "sverklo_test_map":
          result = handleTestMap(indexer, args || {});
          break;
        case "sverklo_promote":
          result = handlePromote(indexer, args || {});
          break;
        case "sverklo_demote":
          result = handleDemote(indexer, args || {});
          break;
        case "sverklo_clusters":
          result = handleClusters(indexer, args || {});
          break;

        // Zilliz compat aliases
        case "search_code": {
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
          const status = indexer.getStatus();
          if (status.indexing) {
            result =
              `Indexing already in progress: ${status.progress?.done ?? 0}/` +
              `${status.progress?.total ?? 0} files. Use get_indexing_status to monitor.`;
          } else {
            indexer.index().catch((err) => {
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
          indexer.index().catch((err) => {
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

      // Hints
      if (process.env.SVERKLO_DISABLE_HINTS !== "1") {
        const argRecord = (args || {}) as Record<string, unknown>;
        hints.record(name, argRecord);
        const hintBlock = hints.buildHint(name, argRecord);
        if (hintBlock) result = result + "\n" + hintBlock;
      }

      if (name.startsWith("sverklo_")) {
        void track("tool.call", {
          tool: name,
          outcome: __telemetryOutcome,
          duration_ms: Date.now() - __telemetryStart,
        });
      }

      trace.end(result.length);

      return {
        content: [{ type: "text", text: result }],
      };
    } catch (err) {
      __telemetryOutcome = "error";
      trace.error(err);
      if (name.startsWith("sverklo_")) {
        void track("tool.call", {
          tool: name,
          outcome: "error",
          duration_ms: Date.now() - __telemetryStart,
        });
      }
      const message = err instanceof Error ? err.message : "Unknown error";
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

  log("MCP server started in global mode (multi-repo)");

  // Handle shutdown
  process.on("SIGINT", () => {
    pool.close();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    pool.close();
    process.exit(0);
  });
}

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

export async function startMcpServer(rootPath: string): Promise<void> {
  const config = getProjectConfig(rootPath);
  const indexer = new Indexer(config);

  // Start indexing in background
  const indexPromise = indexer.index().catch((err) => {
    logError("Initial indexing failed", err);
  });

  // Start file watcher
  startWatcher(indexer, rootPath);

  const server = new Server(
    {
      name: "sverklo",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
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

      // Top memories (most accessed, highest confidence)
      const memories = indexer.memoryStore.getAll(5);
      if (memories.length > 0) {
        parts.push("## Key Memories");
        for (const m of memories) {
          const stale = m.is_stale ? " [STALE]" : "";
          parts.push(`- [${m.category}]${stale} ${m.content}`);
        }
        parts.push("");
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
    ],
  }));

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Ensure index is ready for search operations
    if (name !== "sverklo_status") {
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

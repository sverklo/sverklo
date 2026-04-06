import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
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
      },
    }
  );

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
    if (name !== "index_status") {
      await indexPromise;
    }

    try {
      let result: string;

      switch (name) {
        case "search":
          result = await handleSearch(indexer, args || {});
          break;
        case "overview":
          result = handleOverview(indexer, args || {});
          break;
        case "lookup":
          result = handleLookup(indexer, args || {});
          break;
        case "find_references":
          result = handleFindReferences(indexer, args || {});
          break;
        case "dependencies":
          result = handleDependencies(indexer, args || {});
          break;
        case "index_status":
          result = handleIndexStatus(indexer);
          break;
        case "remember":
          result = await handleRemember(indexer, args || {});
          break;
        case "recall":
          result = await handleRecall(indexer, args || {});
          break;
        case "forget":
          result = handleForget(indexer, args || {});
          break;
        case "memories":
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

#!/usr/bin/env node

import { resolve } from "node:path";

const args = process.argv.slice(2);
const command = args[0];

if (command === "setup" || command === "install") {
  const { setupModels } = await import("../src/indexer/setup.js");
  await setupModels();
  process.exit(0);
}

if (command === "--help" || command === "-h") {
  console.log(`
lumen — code intelligence for AI agents

Usage:
  lumen [project-path]    Start the MCP server (stdio transport)
  lumen setup             Download the embedding model (~90MB)
  lumen --help            Show this help

MCP Tools:
  search          Hybrid text + semantic code search
  overview        Structural codebase map ranked by importance
  lookup          Direct symbol lookup by name
  find_references Find all references to a symbol
  dependencies    Show file dependency graph
  index_status    Check index health

Add to Claude Code:
  claude mcp add lumen -- npx lumen-code .

Environment:
  LUMEN_DEBUG=1   Enable debug logging to stderr
`);
  process.exit(0);
}

const rootPath = resolve(command || process.cwd());

const { startMcpServer } = await import("../src/index.js");
startMcpServer(rootPath).catch((err) => {
  console.error("Failed to start lumen:", err);
  process.exit(1);
});

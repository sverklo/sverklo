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
sverklo — code intelligence for AI agents

Usage:
  sverklo [project-path]    Start the MCP server (stdio transport)
  sverklo setup             Download the embedding model (~90MB)
  sverklo --help            Show this help

MCP Tools:
  search          Hybrid text + semantic code search
  overview        Structural codebase map ranked by importance
  lookup          Direct symbol lookup by name
  find_references Find all references to a symbol
  dependencies    Show file dependency graph
  index_status    Check index health

Add to Claude Code:
  claude mcp add sverklo -- npx sverklo .

Environment:
  SVERKLO_DEBUG=1   Enable debug logging to stderr
`);
  process.exit(0);
}

const rootPath = resolve(command || process.cwd());

const { startMcpServer } = await import("../src/index.js");
startMcpServer(rootPath).catch((err) => {
  console.error("Failed to start sverklo:", err);
  process.exit(1);
});

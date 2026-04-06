#!/usr/bin/env node

import { resolve } from "node:path";
import { startMcpServer } from "../src/index.js";

const rootPath = resolve(process.argv[2] || process.cwd());

startMcpServer(rootPath).catch((err) => {
  console.error("Failed to start codesearch-mcp:", err);
  process.exit(1);
});

#!/usr/bin/env node

import { resolve } from "node:path";

const args = process.argv.slice(2);
const command = args[0];

if (command === "--version" || command === "-v" || command === "-V") {
  const { readFileSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const binDir = dirname(fileURLToPath(import.meta.url));
  // Try both ../package.json (source) and ../../package.json (dist)
  for (const rel of ["..", "../.."]) {
    try {
      const pkg = JSON.parse(readFileSync(join(binDir, rel, "package.json"), "utf-8"));
      console.log(`sverklo v${pkg.version}`);
      process.exit(0);
    } catch {}
  }
  console.log("sverklo (version unknown)");
  process.exit(0);
}

if (command === "setup" || command === "install") {
  const { setupModels } = await import("../src/indexer/setup.js");
  await setupModels();
  process.exit(0);
}

if (command === "ui" || command === "dashboard") {
  const projectPath = resolve(args[1] || process.cwd());
  const { existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { homedir } = await import("node:os");
  const modelDir = join(homedir(), ".sverklo", "models");
  if (!existsSync(join(modelDir, "model.onnx"))) {
    console.log("Downloading embedding model (~90MB)...");
    const { setupModels } = await import("../src/indexer/setup.js");
    await setupModels().catch(() => {});
  }
  const { getProjectConfig } = await import("../src/utils/config.js");
  const { Indexer } = await import("../src/indexer/indexer.js");
  const { startHttpServer } = await import("../src/server/http-server.js");
  const config = getProjectConfig(projectPath);
  const indexer = new Indexer(config);
  await indexer.index();
  startHttpServer(indexer);
  const port = 3847;
  console.log(`\nSverklo Dashboard: http://localhost:${port}\n`);
  // Open browser
  const { exec } = await import("node:child_process");
  exec(`open http://localhost:${port} 2>/dev/null || xdg-open http://localhost:${port} 2>/dev/null`);
  // Keep alive
  process.on("SIGINT", () => { indexer.close(); process.exit(0); });
  await new Promise(() => {}); // block forever
}

if (command === "--help" || command === "-h") {
  console.log(`
sverklo — code intelligence for AI agents

Usage:
  sverklo [project-path]    Start the MCP server (stdio transport)
  sverklo ui [project-path] Open the web dashboard
  sverklo setup             Download the embedding model (~90MB)
  sverklo --help            Show this help

Add to your AI agent:
  Claude Code:  claude mcp add sverklo -- npx sverklo .
  Cursor:       Add to .cursor/mcp.json
  Windsurf:     Add to ~/.windsurf/mcp.json
  VS Code:      Add to .vscode/mcp.json

Environment:
  SVERKLO_DEBUG=1   Enable debug logging to stderr
`);
  process.exit(0);
}

const rootPath = resolve(command || process.cwd());

// Auto-download model if missing (no separate setup step needed)
const { existsSync } = await import("node:fs");
const { join } = await import("node:path");
const { homedir } = await import("node:os");
const modelDir = join(homedir(), ".sverklo", "models");
if (!existsSync(join(modelDir, "model.onnx"))) {
  process.stderr.write("[sverklo] First run — downloading embedding model (~90MB)...\n");
  const { setupModels } = await import("../src/indexer/setup.js");
  await setupModels().catch(() => {
    process.stderr.write("[sverklo] Model download failed. Search will use lightweight embeddings.\n");
  });
}

const { startMcpServer } = await import("../src/index.js");
startMcpServer(rootPath).catch((err) => {
  console.error("Failed to start sverklo:", err);
  process.exit(1);
});

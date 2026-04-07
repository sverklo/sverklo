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

if (command === "init") {
  // Parse flags: --auto-capture, --mine-chats
  const flags = args.filter((a) => a.startsWith("--"));
  const positional = args.filter((a) => !a.startsWith("--"));
  const autoCapture = flags.includes("--auto-capture");
  const mineChats = flags.includes("--mine-chats");
  const projectPath = resolve(positional[1] || process.cwd());
  const { initProject } = await import("../src/init.js");
  await initProject(projectPath, { autoCapture, mineChats });
  process.exit(0);
}

if (command === "workspace") {
  const sub = args[1];
  const {
    createWorkspace,
    loadWorkspace,
    listWorkspaces,
    addRepoToWorkspace,
    removeRepoFromWorkspace,
  } = await import("../src/workspace.js");

  if (sub === "create") {
    const name = args[2];
    if (!name) { console.error("Usage: sverklo workspace create <name> [path1] [path2]..."); process.exit(1); }
    const repos = args.slice(3).length > 0 ? args.slice(3) : [process.cwd()];
    const ws = createWorkspace(name, repos);
    console.log(`Created workspace '${name}' with ${ws.repos.length} repo(s):`);
    for (const r of ws.repos) console.log(`  · ${r.path}`);
    process.exit(0);
  }

  if (sub === "list") {
    const all = listWorkspaces();
    if (all.length === 0) {
      console.log("No workspaces. Create one with: sverklo workspace create <name> [paths...]");
    } else {
      console.log("Workspaces:");
      for (const name of all) {
        const ws = loadWorkspace(name);
        if (ws) console.log(`  · ${name} (${ws.repos.length} repos)`);
      }
    }
    process.exit(0);
  }

  if (sub === "add") {
    const name = args[2];
    const path = args[3] || process.cwd();
    if (!name) { console.error("Usage: sverklo workspace add <name> [path]"); process.exit(1); }
    const ws = addRepoToWorkspace(name, path);
    console.log(`Workspace '${name}' now has ${ws.repos.length} repos`);
    process.exit(0);
  }

  if (sub === "remove") {
    const name = args[2];
    const path = args[3];
    if (!name || !path) { console.error("Usage: sverklo workspace remove <name> <path>"); process.exit(1); }
    const ws = removeRepoFromWorkspace(name, path);
    if (ws) console.log(`Workspace '${name}' now has ${ws.repos.length} repos`);
    else console.error(`Workspace '${name}' not found`);
    process.exit(0);
  }

  if (sub === "show") {
    const name = args[2];
    if (!name) { console.error("Usage: sverklo workspace show <name>"); process.exit(1); }
    const ws = loadWorkspace(name);
    if (!ws) { console.error(`Workspace '${name}' not found`); process.exit(1); }
    console.log(`Workspace: ${ws.name}`);
    console.log(`Repos (${ws.repos.length}):`);
    for (const r of ws.repos) console.log(`  · ${r.alias || ""} ${r.path}`);
    process.exit(0);
  }

  console.log(`
sverklo workspace — manage multi-repo workspaces

Usage:
  sverklo workspace create <name> [paths...]    Create a workspace
  sverklo workspace add <name> [path]           Add a repo to a workspace
  sverklo workspace remove <name> <path>        Remove a repo from a workspace
  sverklo workspace list                        List all workspaces
  sverklo workspace show <name>                 Show repos in a workspace
`);
  process.exit(0);
}

if (command === "wakeup" || command === "wake-up") {
  const projectPath = resolve(args[1] || process.cwd());
  const { existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { homedir } = await import("node:os");
  const modelDir = join(homedir(), ".sverklo", "models");
  if (!existsSync(join(modelDir, "model.onnx"))) {
    const { setupModels } = await import("../src/indexer/setup.js");
    await setupModels().catch(() => {});
  }
  const { getProjectConfig } = await import("../src/utils/config.js");
  const { Indexer } = await import("../src/indexer/indexer.js");
  const { generateWakeup } = await import("../src/server/tools/wakeup.js");
  const config = getProjectConfig(projectPath);
  const indexer = new Indexer(config);
  // Use existing index — don't re-run
  const output = generateWakeup(indexer, { maxTokens: 500 });
  indexer.close();
  console.log(output);
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
  sverklo init              Set up sverklo in your project (CLAUDE.md + hooks + MCP config)
  sverklo [project-path]    Start the MCP server (stdio transport)
  sverklo ui [project-path] Open the web dashboard
  sverklo wakeup            Print compressed project context (for system-prompt injection)
  sverklo setup             Download the embedding model (~90MB)
  sverklo --help            Show this help

Quick start:
  npm install -g sverklo
  cd your-project && sverklo init
  claude   # start coding — sverklo tools are preferred automatically

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

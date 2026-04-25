#!/usr/bin/env node

import { resolve } from "node:path";

const args = process.argv.slice(2);
const command = args[0];

/**
 * Resolve a project path from a subcommand's flag list. If the first
 * non-flag arg is set, treat it as the project path; otherwise fall
 * back to cwd. Errors and exits when the resolved path doesn't exist.
 * Use this in any subcommand that historically hard-coded process.cwd().
 */
async function resolveProjectPath(flags: string[]): Promise<string> {
  const { existsSync, statSync } = await import("node:fs");
  const positional = flags.find((a) => !a.startsWith("-"));
  const target = resolve(positional ?? process.cwd());
  if (!existsSync(target)) {
    console.error(`\n✗ project path not found: ${target}\n`);
    process.exit(2);
  }
  if (!statSync(target).isDirectory()) {
    console.error(`\n✗ project path is not a directory: ${target}\n`);
    process.exit(2);
  }
  return target;
}

// Global --help / -h interceptor.
//
// Without this, `--help` falls through to whatever subcommand the user
// typed. That used to be catastrophic: `sverklo wiki --help` wrote 61
// markdown files into the user's repo, `sverklo init --help` rewrote
// `~/.gemini/antigravity/mcp_config.json`, `sverklo register --help`
// registered the literal string "--help" as a repo at /private/tmp/--help.
// Catching --help/-h here, BEFORE any subcommand's destructive setup
// runs, makes the gesture safe.
if (command && command !== "--help" && command !== "-h") {
  const wantsHelp = args.slice(1).some((a) => a === "--help" || a === "-h");
  if (wantsHelp) {
    const HELP_BLURBS: Record<string, string> = {
      init: "Set up sverklo in your project (.mcp.json + CLAUDE.md, auto-detects Claude Code/Cursor/Windsurf/Antigravity).",
      doctor: "Diagnose MCP setup issues. Run after `init` to verify the agent can reach sverklo.",
      audit: "Run codebase audit and emit a graded report. Flags: --format markdown|html|json|graph|arch|obsidian, --output PATH, --open, --badge, --publish.",
      review: "Risk-scored diff review (CI-friendly). Flags: --ref REF, --ci, --format markdown|json, --max-files N, --fail-on low|medium|high.",
      wiki: "Generate a markdown wiki from the indexed codebase. Flags: --output DIR (default ./sverklo-wiki), --format markdown|html.",
      "concept-index": "Label clusters with an LLM (requires Ollama). Flags: --model NAME, --base-url URL, --force, --max N.",
      "enrich-symbols": "Add LLM-generated purpose to top-PageRank symbols (requires Ollama). Flags: --top N, --model NAME, --base-url URL, --force.",
      "enrich-patterns": "Tag top-PageRank symbols with design patterns (requires Ollama). Flags: --top N, --model NAME, --base-url URL, --min-conf X, --force.",
      register: "Add a directory to the global registry. Usage: sverklo register [path] (defaults to cwd).",
      unregister: "Remove a repo from the global registry. Usage: sverklo unregister <name>.",
      list: "List all registered repositories.",
      workspace: "Manage cross-repo workspaces. Subcommands: create, list, index, add, remove.",
      ui: "Open the web dashboard. Usage: sverklo ui [project-path].",
      dashboard: "Alias for `sverklo ui`.",
      wakeup: "Print compressed project context (for system-prompt injection in non-MCP clients).",
      digest: "5-line summary of what changed in this project. Flags: --since 7d, --format markdown|plain.",
      "audit-prompt": "Print a ready-to-paste codebase-audit prompt (hybrid agent workflow).",
      "review-prompt": "Print a ready-to-paste PR/MR-review prompt (hybrid agent workflow).",
      bench: "Run reproducible benchmarks on gin/nestjs/react.",
      benchmark: "Alias for `sverklo bench`.",
      history: "Show audit grade history and trend over time.",
      activity: "Show recent activity log (always-on audit trail).",
      trace: "Show recent tool call traces (set SVERKLO_TRACE=1).",
      telemetry: "Manage opt-in telemetry (off by default). Subcommands: status, enable, disable.",
      setup: "Download the embedding model (~90MB). With --global: write global MCP config for Claude Code.",
      install: "Alias for `sverklo setup`.",
      prune: "", // prune already prints its own --help inside the block
    };

    // Pass-throughs: subcommands that handle --help themselves.
    const SELF_HANDLES_HELP = new Set(["prune"]);
    if (!SELF_HANDLES_HELP.has(command)) {
      const blurb = HELP_BLURBS[command];
      if (blurb) {
        console.log(`\nsverklo ${command} — ${blurb}\n\nSee \`sverklo --help\` for the full command list.\n`);
      } else {
        console.log(`\nsverklo: unknown subcommand \`${command}\`.\n\nRun \`sverklo --help\` for the list of subcommands.\n`);
      }
      process.exit(0);
    }
  }
}

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

  // Auto-register in the global registry
  const { basename } = await import("node:path");
  const { registerRepo, deriveRepoName } = await import("../src/registry/registry.js");
  const repoName = deriveRepoName(projectPath);
  registerRepo(repoName, projectPath);
  console.log(`  Global registry — registered as "${repoName}"`);

  process.exit(0);
}

if (command === "register") {
  // Reject flag-shaped positionals (e.g. someone typed `register --foo` and
  // we'd otherwise create a repo named "--foo" pointing at /private/tmp/--foo).
  if (args[1] && args[1].startsWith("-")) {
    console.error(`✗ register expects a directory path, got flag-shaped arg: ${args[1]}`);
    console.error("  Usage: sverklo register [path] [name]");
    process.exit(2);
  }
  const targetPath = resolve(args[1] || process.cwd());
  const { registerRepo, deriveRepoName, getRegistryPath } = await import("../src/registry/registry.js");
  const repoName = args[2] || deriveRepoName(targetPath);
  registerRepo(repoName, targetPath);
  console.log(`Registered "${repoName}" -> ${targetPath}`);
  console.log(`Registry: ${getRegistryPath()}`);
  process.exit(0);
}

if (command === "unregister") {
  const name = args[1];
  if (!name) {
    console.error("Usage: sverklo unregister <name>");
    console.error("Use `sverklo list` to see registered repos.");
    process.exit(1);
  }
  const { unregisterRepo, getRegistry } = await import("../src/registry/registry.js");
  const repos = getRegistry();
  if (!repos[name]) {
    console.error(`Repo "${name}" not found in registry.`);
    const available = Object.keys(repos);
    if (available.length > 0) {
      console.error(`Available: ${available.join(", ")}`);
    }
    process.exit(1);
  }
  unregisterRepo(name);
  console.log(`Unregistered "${name}"`);
  process.exit(0);
}

if (command === "list") {
  const { getRegistry, getRegistryPath } = await import("../src/registry/registry.js");
  const repos = getRegistry();
  const entries = Object.entries(repos);
  if (entries.length === 0) {
    console.log("No repositories registered.");
    console.log("Register with: sverklo register [path] or sverklo init");
  } else {
    console.log(`Registered repositories (${entries.length}):`);
    console.log("");
    const now = Date.now();
    for (const [name, entry] of entries) {
      const age = now - new Date(entry.lastIndexed).getTime();
      const ageStr = age < 60_000 ? `${Math.floor(age / 1000)}s ago`
        : age < 3_600_000 ? `${Math.floor(age / 60_000)} min ago`
        : age < 86_400_000 ? `${Math.floor(age / 3_600_000)} hours ago`
        : `${Math.floor(age / 86_400_000)} days ago`;
      console.log(`  ${name}`);
      console.log(`    path: ${entry.path}`);
      console.log(`    last indexed: ${ageStr}`);
      console.log("");
    }
    console.log(`Registry: ${getRegistryPath()}`);
  }
  process.exit(0);
}

if (command === "bench" || command === "benchmark") {
  // Reproducible benchmark runner. Clones pinned versions of gin, nestjs,
  // and react into ~/.sverklo-bench-cache, runs the perf profiler against
  // each, and prints a summary. Everything in BENCHMARKS.md should come
  // out of this command so readers can reproduce the numbers with one
  // invocation. Inspired by ripgrep's benchsuite.
  const { spawn } = await import("node:child_process");
  const { dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { existsSync } = await import("node:fs");
  const here = dirname(fileURLToPath(import.meta.url));
  // Try source layout first (running from checkout), then installed dist.
  const candidates = [
    resolve(here, "..", "scripts", "bench-reproducer.mjs"),
    resolve(here, "..", "..", "scripts", "bench-reproducer.mjs"),
  ];
  const scriptPath = candidates.find((p) => existsSync(p));
  if (!scriptPath) {
    console.error(
      "sverklo bench: could not find scripts/bench-reproducer.mjs.\n" +
        "This command is only available when running from a sverklo checkout,\n" +
        "not from the npm-installed package (the bench scripts aren't shipped\n" +
        "in `files` to keep the package small). Clone the repo and run it from\n" +
        "there:\n\n" +
        "  git clone https://github.com/sverklo/sverklo && cd sverklo\n" +
        "  npm install && npm run build\n" +
        "  npm run bench"
    );
    process.exit(1);
  }
  const child = spawn("node", [scriptPath, ...args.slice(1)], { stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 0));
  // Keep alive until spawn exit
  await new Promise(() => {});
}

if (command === "audit-prompt" || command === "review-prompt") {
  // Emit a ready-to-paste prompt that encodes the hybrid workflow
  // (prefer sverklo tools for discovery, built-in tools for exact
  // patterns and line-level reading). Pipe into `pbcopy` on macOS or
  // `xclip -sel clip` on Linux, or paste directly into your agent.
  const { renderAuditPrompt } = await import("../src/audit-prompt.js");
  const mode = command === "review-prompt" ? "review" : "audit";
  process.stdout.write(renderAuditPrompt(mode));
  process.exit(0);
}

if (command === "doctor" || command === "diagnose" || command === "check") {
  const projectPath = resolve(args[1] || process.cwd());
  const { runDoctor } = await import("../src/doctor.js");
  runDoctor(projectPath);
  process.exit(0);
}

if (command === "workspace") {
  const sub = args[1];

  // --- Cross-repo workspace commands (new YAML-based) ---

  if (sub === "init") {
    const name = args[2];
    const paths = args.slice(3);
    if (!name || paths.length === 0) {
      console.error("Usage: sverklo workspace init <name> <path1> <path2> ...");
      process.exit(1);
    }
    const { workspaceInit } = await import("../src/workspace/cli.js");
    await workspaceInit(name, paths);
    process.exit(0);
  }

  if (sub === "status") {
    const name = args[2]; // optional
    const { workspaceStatus } = await import("../src/workspace/cli.js");
    const output = await workspaceStatus(name);
    console.log(output);
    process.exit(0);
  }

  if (sub === "index") {
    const name = args[2];
    if (!name) { console.error("Usage: sverklo workspace index <name>"); process.exit(1); }
    const { workspaceIndex } = await import("../src/workspace/cli.js");
    await workspaceIndex(name);
    process.exit(0);
  }

  // --- Legacy workspace commands (JSON-based, kept for backwards compat) ---

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
  sverklo workspace init <name> <p1> <p2> ...   Create cross-repo workspace (YAML)
  sverklo workspace status [name]                Show workspace health & staleness
  sverklo workspace index <name>                 Index all projects in a workspace
  sverklo workspace create <name> [paths...]     Create a workspace (legacy JSON)
  sverklo workspace add <name> [path]            Add a repo to a workspace
  sverklo workspace remove <name> <path>         Remove a repo from a workspace
  sverklo workspace list                         List all workspaces
  sverklo workspace show <name>                  Show repos in a workspace
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
  if (args.includes("--global")) {
    // Write global MCP config for Claude Code pointing to the global sverklo server
    const { existsSync, readFileSync, writeFileSync, mkdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { homedir } = await import("node:os");
    const { execSync } = await import("node:child_process");

    let sverkloBin = "sverklo";
    try {
      sverkloBin = execSync("command -v sverklo", { encoding: "utf-8" }).trim() || "sverklo";
    } catch {}

    // Claude Code global settings: ~/.claude/settings.json
    const claudeSettingsDir = join(homedir(), ".claude");
    const claudeSettingsPath = join(claudeSettingsDir, "settings.json");
    mkdirSync(claudeSettingsDir, { recursive: true });

    type ClaudeSettings = {
      mcpServers?: Record<string, { command: string; args?: string[] }>;
      permissions?: { allow?: string[] };
      [key: string]: unknown;
    };

    let claudeSettings: ClaudeSettings = {};
    if (existsSync(claudeSettingsPath)) {
      try {
        claudeSettings = JSON.parse(readFileSync(claudeSettingsPath, "utf-8"));
      } catch {
        claudeSettings = {};
      }
    }

    if (!claudeSettings.mcpServers) claudeSettings.mcpServers = {};
    claudeSettings.mcpServers.sverklo = {
      command: sverkloBin,
      args: [],  // No path arg = global mode
    };

    // Auto-allow sverklo tools
    if (!claudeSettings.permissions) claudeSettings.permissions = {};
    if (!claudeSettings.permissions.allow) claudeSettings.permissions.allow = [];
    const allowList = claudeSettings.permissions.allow;
    if (!allowList.some((p: string) => p === "mcp__sverklo__*" || p.startsWith("mcp__sverklo__"))) {
      allowList.push("mcp__sverklo__*");
    }

    writeFileSync(claudeSettingsPath, JSON.stringify(claudeSettings, null, 2) + "\n");
    console.log(`Global MCP config written to ${claudeSettingsPath}`);
    console.log(`  Server command: ${sverkloBin} (no args = global mode)`);
    console.log("");
    console.log("The global sverklo server will serve all repos in ~/.sverklo/registry.json.");
    console.log("Register repos with: sverklo register /path/to/project");
    console.log("Or run `sverklo init` in each project directory.");
    process.exit(0);
  }

  const { setupModels } = await import("../src/indexer/setup.js");
  await setupModels();
  process.exit(0);
}

if (command === "telemetry") {
  const sub = args[1];
  const tel = await import("../src/telemetry/index.js");

  if (sub === "enable") {
    console.log("");
    console.log("Sverklo telemetry is currently OFF. Enabling sends:");
    console.log("");
    console.log("  install_id  one random UUID stored at ~/.sverklo/install-id");
    console.log("  version     current sverklo version");
    console.log("  os          darwin / linux / win32");
    console.log("  node_major  the Node major version sverklo is running on");
    console.log("  event       one of 17 fixed event types");
    console.log("  tool        sverklo_* tool name (when applicable)");
    console.log("  outcome     ok / error / timeout");
    console.log("  duration_ms tool execution time");
    console.log("");
    console.log("It does NOT send:");
    console.log("  - code, queries, file paths, symbol names, or memory contents");
    console.log("  - IP addresses, hostnames, or project identifiers");
    console.log("  - git remote URLs, branch names, or SHAs");
    console.log("");
    console.log("Every event is mirrored to ~/.sverklo/telemetry.log so you can see");
    console.log("exactly what gets sent. The endpoint source code lives at");
    console.log("https://github.com/sverklo/sverklo/tree/main/telemetry-endpoint");
    console.log("and the sending code is at src/telemetry/index.ts (under 250 lines).");
    console.log("");

    // Read y/n from stdin if interactive, otherwise --yes flag.
    // Pass the prompt directly to readline.question() — doing a prior
    // stdout.write() and then question("") races with the TTY handoff
    // on some terminal/Node combinations and the prompt never shows.
    const autoYes = args.includes("--yes") || args.includes("-y");
    let confirmed = autoYes;
    if (!autoYes) {
      if (!process.stdin.isTTY) {
        console.log("Non-interactive stdin — pass --yes to confirm enable.");
        console.log("Cancelled. Telemetry remains OFF.");
        process.exit(0);
      }
      const readline = await import("node:readline/promises");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      // Clean exit on SIGINT so ctrl-C doesn't leave the terminal in a bad state.
      rl.on("SIGINT", () => {
        rl.close();
        console.log("");
        console.log("Cancelled. Telemetry remains OFF.");
        process.exit(0);
      });
      try {
        const answer = (await rl.question("Type 'yes' to enable, anything else to cancel: ")).trim().toLowerCase();
        confirmed = answer === "yes" || answer === "y";
      } catch {
        // User hit ctrl-D / ctrl-C / the terminal closed — treat as cancel.
        confirmed = false;
      } finally {
        rl.close();
      }
    }
    if (!confirmed) {
      console.log("");
      console.log("Cancelled. Telemetry remains OFF.");
      process.exit(0);
    }

    const id = await tel.enable();
    console.log("");
    console.log(`Telemetry enabled. install_id: ${id}`);
    console.log(`Local mirror: ${tel.logPath}`);
    console.log("Disable any time with:  sverklo telemetry disable");
    process.exit(0);
  }

  if (sub === "disable") {
    await tel.disable();
    console.log("");
    console.log("Telemetry disabled. The disabled sentinel is permanent —");
    console.log("you'll need to run `sverklo telemetry enable` again to re-opt-in.");
    process.exit(0);
  }

  if (sub === "status") {
    const s = tel.status();
    console.log("");
    console.log(`telemetry: ${s.enabled ? "ON" : "OFF"}`);
    if (s.installId) console.log(`install_id: ${s.installId}`);
    console.log(`endpoint:  ${s.endpoint}`);
    console.log(`local log: ${s.logPath}`);
    console.log("");
    if (!s.enabled) {
      console.log("Enable with:  sverklo telemetry enable");
    } else {
      console.log("Disable with: sverklo telemetry disable");
      console.log("Tail log:     sverklo telemetry log");
    }
    process.exit(0);
  }

  if (sub === "log") {
    const { existsSync, readFileSync } = await import("node:fs");
    if (!existsSync(tel.logPath)) {
      console.log("No telemetry log yet. Enable with: sverklo telemetry enable");
      process.exit(0);
    }
    process.stdout.write(readFileSync(tel.logPath, "utf-8"));
    process.exit(0);
  }

  console.log(`
sverklo telemetry — opt-in, privacy-preserving, off by default

Usage:
  sverklo telemetry enable    Opt in (interactive prompt; prints exact schema first)
  sverklo telemetry disable   Opt out permanently (sends one final opt_out event)
  sverklo telemetry status    Show current state
  sverklo telemetry log       Print the local mirror of every event sent

Design doc: https://github.com/sverklo/sverklo/blob/main/TELEMETRY.md
`);
  process.exit(0);
}

if (command === "activity") {
  const projectPath = resolve(args[1] || process.cwd());
  const count = parseInt(args[2] || "30", 10) || 30;
  const { getActivityLog } = await import("../src/utils/activity-log.js");
  const entries = getActivityLog(projectPath, count);

  if (entries.length === 0) {
    console.log("No activity recorded yet. Activity is logged automatically when the MCP server handles tool calls.");
    process.exit(0);
  }

  console.log(`\n  Sverklo Activity Log (last ${entries.length} entries)\n`);
  console.log("  " + "-".repeat(70));

  for (const entry of entries) {
    const time = new Date(entry.ts).toISOString().replace("T", " ").replace("Z", "");
    const detail = Object.entries(entry.detail)
      .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join("  ");
    console.log(`  ${time}  ${entry.event}  ${detail}`);
  }

  console.log("  " + "-".repeat(70) + "\n");
  process.exit(0);
}

if (command === "trace") {
  const { existsSync, readFileSync } = await import("node:fs");
  const { TRACE_PATH } = await import("../src/utils/trace.js");

  if (!existsSync(TRACE_PATH)) {
    console.log("No trace log found at " + TRACE_PATH);
    console.log("Traces are recorded when SVERKLO_DEBUG=1 or SVERKLO_TRACE=1 is set.");
    process.exit(0);
  }

  const content = readFileSync(TRACE_PATH, "utf-8").trim();
  if (!content) {
    console.log("Trace log is empty.");
    process.exit(0);
  }

  const lines = content.split("\n");
  const count = parseInt(args[1] || "20", 10) || 20;
  const recent = lines.slice(-count);

  console.log(`\n  Sverklo Trace Log (last ${Math.min(count, recent.length)} entries)\n`);
  console.log("  " + "-".repeat(70));

  for (const line of recent) {
    try {
      const entry = JSON.parse(line);
      const time = new Date(entry.ts).toISOString().replace("T", " ").replace("Z", "");

      if (entry.phase === "request") {
        const argStr = Object.keys(entry.args || {}).length > 0
          ? " " + JSON.stringify(entry.args)
          : "";
        console.log(`  ${time}  ${entry.trace}  -> ${entry.tool}${argStr}`);
      } else if (entry.phase === "response") {
        console.log(`  ${time}  ${entry.trace}  <- ${entry.duration_ms}ms  ${entry.result_chars} chars`);
      } else if (entry.phase === "error") {
        console.log(`  ${time}  ${entry.trace}  !! ${entry.duration_ms}ms  ${entry.error}`);
      }
    } catch {
      // Skip malformed lines
    }
  }

  console.log("  " + "-".repeat(70));
  console.log(`  Log: ${TRACE_PATH}\n`);
  process.exit(0);
}

if (command === "review") {
  // CI-friendly review subcommand: indexes the repo, runs review_diff,
  // prints markdown (or JSON) to stdout, and optionally exits non-zero if
  // the highest risk level exceeds a threshold.
  //
  //   sverklo review [--ref <ref>] [--ci] [--format markdown|json]
  //                  [--max-files 25] [--fail-on critical|high|medium|low|none]

  const flags = args.slice(1);
  const flagVal = (name: string, fallback: string): string => {
    const idx = flags.indexOf(name);
    return idx !== -1 && flags[idx + 1] ? flags[idx + 1] : fallback;
  };

  const ref = flagVal("--ref", "");
  const ci = flags.includes("--ci");
  const format = flagVal("--format", "markdown") as "markdown" | "json";
  const maxFiles = parseInt(flagVal("--max-files", "25"), 10) || 25;
  const failOn = flagVal("--fail-on", "none") as
    | "critical"
    | "high"
    | "medium"
    | "low"
    | "none";

  // Auto-detect ref: if inside a PR (GH Actions sets GITHUB_BASE_REF),
  // use origin/$GITHUB_BASE_REF..HEAD. Otherwise default to main..HEAD.
  const effectiveRef =
    ref ||
    (process.env.GITHUB_BASE_REF
      ? `origin/${process.env.GITHUB_BASE_REF}..HEAD`
      : "main..HEAD");

  const projectPath = await resolveProjectPath(flags);

  // Ensure model is available
  const { existsSync: modelExists } = await import("node:fs");
  const { join: joinPath } = await import("node:path");
  const { homedir: hd } = await import("node:os");
  const mDir = joinPath(hd(), ".sverklo", "models");
  if (!modelExists(joinPath(mDir, "model.onnx"))) {
    if (ci) process.stderr.write("[sverklo] Downloading embedding model...\n");
    const { setupModels } = await import("../src/indexer/setup.js");
    await setupModels().catch(() => {});
  }

  const { getProjectConfig } = await import("../src/utils/config.js");
  const { Indexer } = await import("../src/indexer/indexer.js");
  const { handleReviewDiff } = await import(
    "../src/server/tools/review-diff.js"
  );

  const config = getProjectConfig(projectPath);
  const indexer = new Indexer(config);
  await indexer.index();

  const markdown = handleReviewDiff(indexer, {
    ref: effectiveRef,
    max_files: maxFiles,
    token_budget: 8000,
  });

  indexer.close();

  if (format === "json") {
    // Wrap the markdown in a JSON envelope with parsed risk level
    const riskLevels = ["low", "medium", "high", "critical"] as const;
    type RiskLevel = (typeof riskLevels)[number];
    let maxRisk: RiskLevel = "low";
    for (const level of riskLevels) {
      if (markdown.includes(`(${level})`)) maxRisk = level;
    }
    const output = {
      ref: effectiveRef,
      max_risk: maxRisk,
      review: markdown,
    };
    process.stdout.write(JSON.stringify(output, null, 2) + "\n");
  } else {
    process.stdout.write(markdown + "\n");
  }

  // Check fail-on threshold
  if (failOn !== "none") {
    const levelOrder: Record<string, number> = {
      low: 1,
      medium: 2,
      high: 3,
      critical: 4,
    };
    const threshold = levelOrder[failOn] || 0;
    const riskLevels = ["critical", "high", "medium", "low"];
    let maxFound = 0;
    for (const level of riskLevels) {
      if (markdown.includes(`(${level})`)) {
        maxFound = Math.max(maxFound, levelOrder[level] || 0);
      }
    }
    if (maxFound >= threshold) {
      process.stderr.write(
        `[sverklo] Risk threshold exceeded: found issues at or above '${failOn}'\n`
      );
      process.exit(1);
    }
  }

  process.exit(0);
}

if (command === "history") {
  const projectPath = resolve(args[1] || process.cwd());
  const { getAuditHistory, formatTrend } = await import("../src/utils/audit-history.js");
  const history = getAuditHistory(projectPath);

  if (history.length === 0) {
    console.log("No audit history yet. Run `sverklo audit` first.");
    process.exit(0);
  }

  const projectName = projectPath.split("/").pop() || "unknown";
  console.log(`\nAudit History — ${projectName}\n`);

  // Dimension short names for the compact display
  const SHORT: Record<string, string> = {
    "Dead code": "dead",
    "Circular deps": "deps",
    "Coupling": "coup",
    "Security": "sec",
  };

  const recent = history.slice(-20);
  for (const entry of recent) {
    const sha = entry.sha.slice(0, 7);
    const dims = entry.dimensions
      .map((d) => `${SHORT[d.name] || d.name}:${d.grade}`)
      .join("  ");
    console.log(`${entry.date}  ${sha}  ${entry.grade}  (${entry.numericScore.toFixed(1)})  ${dims}`);
  }

  // Trend line
  if (recent.length >= 2) {
    const grades = recent.map((e) => e.grade);
    console.log(`\nTrend: ${formatTrend(grades)}`);
  }

  console.log("");
  process.exit(0);
}

if (command === "audit") {
  // CLI audit subcommand: indexes the repo, runs audit analysis,
  // outputs markdown, HTML, or JSON.
  //
  //   sverklo audit [--format markdown|html|json] [--output <path>] [--open] [--badge] [--publish]

  const flags = args.slice(1);
  const flagVal = (name: string, fallback: string): string => {
    const idx = flags.indexOf(name);
    return idx !== -1 && flags[idx + 1] ? flags[idx + 1] : fallback;
  };

  const format = flagVal("--format", "markdown") as "markdown" | "html" | "json" | "graph" | "arch" | "obsidian";
  const outputPath = flagVal("--output", format === "html" ? "sverklo-audit.html" : "");
  const shouldOpen = flags.includes("--open");
  const shouldBadge = flags.includes("--badge");
  const shouldPublish = flags.includes("--publish");
  const deepSecurity = flags.includes("--deep-security");

  const projectPath = await resolveProjectPath(flags);

  const { existsSync: modelExists } = await import("node:fs");
  const { join: joinPath } = await import("node:path");
  const { homedir: hd } = await import("node:os");
  const mDir = joinPath(hd(), ".sverklo", "models");
  if (!modelExists(joinPath(mDir, "model.onnx"))) {
    console.log("Downloading embedding model (~90MB)...");
    const { setupModels } = await import("../src/indexer/setup.js");
    await setupModels().catch(() => {});
  }

  const { getProjectConfig } = await import("../src/utils/config.js");
  const { Indexer } = await import("../src/indexer/indexer.js");
  const { handleAudit } = await import("../src/server/tools/audit.js");

  const config = getProjectConfig(projectPath);
  const indexer = new Indexer(config);
  await indexer.index();

  // Run analysis once for history tracking (handleAudit also calls it internally)
  const { analyzeCodebase: runAnalysis } = await import("../src/server/audit-analysis.js");
  const auditAnalysis = runAnalysis(indexer);

  // Auto-save to audit history
  const { appendAuditHistory } = await import("../src/utils/audit-history.js");
  appendAuditHistory(projectPath, auditAnalysis);

  let mdOutput = handleAudit(indexer, { token_budget: 16000 });

  // Deep security scan (semgrep) — optional enhancement
  if (deepSecurity) {
    const { isSemgrepInstalled, runSemgrep, formatSemgrepSection, semgrepSeverityToAudit } =
      await import("../src/utils/semgrep.js");
    if (!(await isSemgrepInstalled())) {
      console.error("semgrep not found. Install: brew install semgrep (or pip install semgrep)");
      process.exit(1);
    }
    console.log("Running deep security scan (semgrep)...");
    const findings = await runSemgrep(projectPath);
    if (findings.length > 0) {
      mdOutput += "\n" + formatSemgrepSection(findings);
      // Merge into auditAnalysis security issues for grade recalculation
      for (const f of findings) {
        auditAnalysis.securityIssues.push({
          file: f.path,
          line: f.line,
          pattern: `semgrep: ${f.rule}`,
          severity: semgrepSeverityToAudit(f.severity),
          snippet: f.message.slice(0, 120),
        });
      }
    } else {
      mdOutput += "\n## Deep Security Scan (semgrep)\n\nNo additional concerns found.\n";
    }
  }

  if (format === "graph") {
    const { analyzeCodebase } = await import("../src/server/audit-analysis.js");
    const { generateAuditGraph } = await import("../src/server/audit-graph.js");
    const analysis = analyzeCodebase(indexer);
    const html = generateAuditGraph(indexer, analysis, config.name);
    indexer.close();
    const { writeFileSync } = await import("node:fs");
    const out = outputPath || "sverklo-graph.html";
    writeFileSync(out, html);
    console.log(`Dependency graph written to ${out}`);
    if (shouldOpen) {
      const { execSync } = await import("node:child_process");
      const cmd = process.platform === "darwin" ? "open" : "xdg-open";
      try { execSync(`${cmd} ${out}`); } catch { /* ignore */ }
    }
    process.exit(0);
  }

  if (format === "arch") {
    const { analyzeCodebase } = await import("../src/server/audit-analysis.js");
    const { generateAuditArch } = await import("../src/server/audit-arch.js");
    const analysis = analyzeCodebase(indexer);
    const html = generateAuditArch(indexer, analysis, config.name);
    indexer.close();
    const { writeFileSync } = await import("node:fs");
    const out = outputPath || "sverklo-arch.html";
    writeFileSync(out, html);
    console.log(`Architecture diagram written to ${out}`);
    if (shouldOpen) {
      const { execSync } = await import("node:child_process");
      const cmd = process.platform === "darwin" ? "open" : "xdg-open";
      try { execSync(`${cmd} ${out}`); } catch { /* ignore */ }
    }
    process.exit(0);
  }

  if (format === "obsidian") {
    const { analyzeCodebase } = await import("../src/server/audit-analysis.js");
    const { generateAuditObsidian } = await import("../src/server/audit-obsidian.js");
    const analysis = analyzeCodebase(indexer);
    const md = generateAuditObsidian(indexer, analysis, config.name);
    indexer.close();
    const { writeFileSync } = await import("node:fs");
    const out = outputPath || "sverklo-obsidian.md";
    writeFileSync(out, md);
    console.log(`Obsidian vault file written to ${out}`);
    if (shouldOpen) {
      const { execSync } = await import("node:child_process");
      const cmd = process.platform === "darwin" ? "open" : "xdg-open";
      try { execSync(`${cmd} ${out}`); } catch { /* ignore */ }
    }
    process.exit(0);
  }

  indexer.close();

  if (shouldBadge || shouldPublish) {
    // Extract grade from the audit output (first line: "# Sverklo Project Audit — Grade: X")
    const gradeMatch = mdOutput.match(/Grade:\s*([ABCDF])/);
    const grade = gradeMatch ? gradeMatch[1] : "?";

    if (shouldPublish) {
      // Detect owner/repo from git remote
      const { execSync: exec } = await import("node:child_process");
      let owner = "", repo = "";
      try {
        const remote = exec("git remote get-url origin", { cwd: projectPath, encoding: "utf8" }).trim();
        const m = remote.match(/[/:]([^/]+)\/([^/.]+?)(?:\.git)?$/);
        if (m) { owner = m[1]; repo = m[2]; }
      } catch { /* no git remote */ }

      if (!owner || !repo) {
        console.error("Could not detect owner/repo from git remote. Run from a git repo with a remote.");
        process.exit(1);
      }

      // Extract dimensions from audit output
      const dimLines = mdOutput.match(/\| (Dead code|Circular deps|Coupling|Security) \| ([ABCDF]) \| (.+?) \|/g) || [];
      const dimensions = dimLines.map(line => {
        const m = line.match(/\| (.+?) \| ([ABCDF]) \| (.+?) \|/);
        return m ? { name: m[1], grade: m[2], detail: m[3] } : null;
      }).filter(Boolean);

      console.log(`Publishing grade ${grade} for ${owner}/${repo}...`);
      try {
        const res = await fetch("https://t.sverklo.com/v1/badge/publish", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ owner, repo, grade, dimensions, version: "0.8.0" }),
        });
        if (res.ok) {
          const badgeUrl = `https://sverklo.com/api/badge/${owner}/${repo}.svg`;
          console.log(`\nPublished! Your dynamic badge:`);
          console.log(`\n[![Sverklo Health: ${grade}](${badgeUrl})](https://sverklo.com/report/${owner}/${repo})\n`);
          console.log(`Badge URL: ${badgeUrl}`);
        } else {
          console.error(`Publish failed: ${res.status} ${await res.text()}`);
        }
      } catch (e) {
        console.error(`Publish failed: ${e}`);
      }
      process.exit(0);
    }

    // --badge only (static, no publish)
    const colorMap: Record<string, string> = { A: "brightgreen", B: "green", C: "yellow", D: "orange", F: "red" };
    const color = colorMap[grade] || "lightgrey";
    const badge = `[![Sverklo Health: ${grade}](https://img.shields.io/badge/sverklo-${grade}-${color})](https://sverklo.com)`;
    console.log("\n── Sverklo Health Badge ──\n");
    console.log("Add this to your README.md:\n");
    console.log(badge);
    console.log("\nFor a dynamic badge that auto-updates, run: sverklo audit --publish\n");
    console.log("── Learn more: https://sverklo.com/badge/ ──\n");
    process.exit(0);
  }

  if (format === "json") {
    // Wrap in a simple JSON envelope
    const json = JSON.stringify({ format: "sverklo-audit", version: "0.4.0", content: mdOutput }, null, 2);
    if (outputPath) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(outputPath, json);
      console.log(`Audit written to ${outputPath}`);
    } else {
      process.stdout.write(json + "\n");
    }
  } else if (format === "html") {
    const { generateAuditHtml } = await import("../src/server/audit-html.js");
    const html = generateAuditHtml(mdOutput, config.name, projectPath);
    const { writeFileSync } = await import("node:fs");
    const out = outputPath || "sverklo-audit.html";
    writeFileSync(out, html);
    console.log(`Audit report written to ${out}`);
    if (shouldOpen) {
      const { execSync } = await import("node:child_process");
      const cmd = process.platform === "darwin" ? "open" : "xdg-open";
      try { execSync(`${cmd} ${out}`); } catch { /* ignore */ }
    }
  } else {
    if (outputPath) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(outputPath, mdOutput);
      console.log(`Audit written to ${outputPath}`);
    } else {
      process.stdout.write(mdOutput + "\n");
    }
  }

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

if (command === "wiki") {
  // Generate a markdown wiki from the indexed codebase.
  //
  //   sverklo wiki [--output <dir>] [--format markdown|html]

  const flags = args.slice(1);
  const flagVal = (name: string, fallback: string): string => {
    const idx = flags.indexOf(name);
    return idx !== -1 && flags[idx + 1] ? flags[idx + 1] : fallback;
  };

  const output = resolve(flagVal("--output", "./sverklo-wiki"));
  const format = flagVal("--format", "markdown") as "markdown" | "html";
  const projectPath = await resolveProjectPath(flags);

  // Ensure model is available
  const { existsSync: modelExists } = await import("node:fs");
  const { join: joinPath } = await import("node:path");
  const { homedir: hd } = await import("node:os");
  const mDir = joinPath(hd(), ".sverklo", "models");
  if (!modelExists(joinPath(mDir, "model.onnx"))) {
    console.log("Downloading embedding model (~90MB)...");
    const { setupModels } = await import("../src/indexer/setup.js");
    await setupModels().catch(() => {});
  }

  const { getProjectConfig } = await import("../src/utils/config.js");
  const { Indexer } = await import("../src/indexer/indexer.js");
  const { generateWiki } = await import("../src/wiki/wiki-generator.js");

  const config = getProjectConfig(projectPath);
  const indexer = new Indexer(config);
  await indexer.index();

  await generateWiki(indexer, { outputDir: output, format });
  indexer.close();
  process.exit(0);
}

if (command === "enrich-patterns") {
  // P2-17: closed-taxonomy design-pattern annotation pass.
  //   sverklo enrich-patterns [--top 200] [--model qwen2.5-coder:7b]
  //                           [--min-conf 0.6] [--force]
  const flags = args.slice(1);
  const flagVal = (name: string, fallback?: string): string | undefined => {
    const idx = flags.indexOf(name);
    if (idx !== -1 && flags[idx + 1]) return flags[idx + 1];
    const prefixed = flags.find((f) => f.startsWith(`${name}=`));
    if (prefixed) return prefixed.slice(name.length + 1);
    return fallback;
  };
  const topN = Number(flagVal("--top", "200"));
  const model = flagVal("--model", "qwen2.5-coder:7b")!;
  const baseUrl = flagVal("--base-url", "http://localhost:11434")!;
  const minConfStr = flagVal("--min-conf", "0.6");
  const minConfidence = Number(minConfStr);
  const force = flags.includes("--force");
  const projectPath = await resolveProjectPath(flags);

  const reach = await fetch(`${baseUrl}/api/tags`).catch(() => null);
  if (!reach || !reach.ok) {
    console.error(`\n✗ Could not reach Ollama at ${baseUrl}.\n`);
    process.exit(1);
  }

  const { existsSync: mEP } = await import("node:fs");
  const { join: jpP } = await import("node:path");
  const { homedir: hdP } = await import("node:os");
  const mDP = jpP(hdP(), ".sverklo", "models");
  if (!mEP(jpP(mDP, "model.onnx"))) {
    console.log("Downloading embedding model (~90MB)...");
    const { setupModels } = await import("../src/indexer/setup.js");
    await setupModels().catch(() => {});
  }

  const { getProjectConfig } = await import("../src/utils/config.js");
  const { Indexer } = await import("../src/indexer/indexer.js");
  const { labelPatterns } = await import("../src/indexer/pattern-labeler.js");

  const config = getProjectConfig(projectPath);
  const indexer = new Indexer(config);
  await indexer.index();

  console.log(
    `Annotating top ${topN} symbols with pattern taxonomy via ${model} ` +
      `(min conf ${minConfidence})${force ? " (forced)" : ""}...`
  );
  const r = await labelPatterns(indexer, {
    topN, model, baseUrl, minConfidence, force,
    onProgress: (done, total, sym) => {
      if (done % 10 === 0 || done + 1 === total) {
        process.stdout.write(
          `  [${done + 1}/${total}] ${sym.slice(0, 40)}${done + 1 === total ? "\n" : "\r"}`
        );
      }
    },
  });
  console.log(
    `\nDone: scanned ${r.scanned}, labeled ${r.labeled}, ` +
      `dropped ${r.skipped_by_taxonomy} taxonomy / ${r.skipped_low_conf} low-conf, failed ${r.failed}.`
  );
  if (r.failures.length > 0) {
    console.log("\nFailures (first 5):");
    for (const f of r.failures.slice(0, 5)) console.log(`  - ${f.symbol}: ${f.reason}`);
  }
  indexer.close();
  // Exit non-zero when nothing succeeded — CI shouldn't green-light a
  // total no-op (e.g. Ollama 404 on the requested model).
  process.exit(r.failed > 0 && r.labeled === 0 ? 1 : 0);
}

if (command === "enrich-symbols") {
  // P1-12: write a one-line purpose onto chunks.purpose for the top-N
  // PageRank symbols. Uses Ollama; cached by content-hash.
  //
  //   sverklo enrich-symbols [--top 200] [--model qwen2.5-coder:7b] [--force]
  const flags = args.slice(1);
  const flagVal = (name: string, fallback?: string): string | undefined => {
    const idx = flags.indexOf(name);
    if (idx !== -1 && flags[idx + 1]) return flags[idx + 1];
    const prefixed = flags.find((f) => f.startsWith(`${name}=`));
    if (prefixed) return prefixed.slice(name.length + 1);
    return fallback;
  };

  const topN = Number(flagVal("--top", "200"));
  const model = flagVal("--model", "qwen2.5-coder:7b")!;
  const baseUrl = flagVal("--base-url", "http://localhost:11434")!;
  const force = flags.includes("--force");
  const projectPath = await resolveProjectPath(flags);

  // Reach check up front.
  const reach = await fetch(`${baseUrl}/api/tags`).catch(() => null);
  if (!reach || !reach.ok) {
    console.error(
      `\n✗ Could not reach Ollama at ${baseUrl}. Install + run Ollama, then \`ollama pull ${model}\`.\n`
    );
    process.exit(1);
  }

  const { existsSync: mE2 } = await import("node:fs");
  const { join: jp2 } = await import("node:path");
  const { homedir: hd2 } = await import("node:os");
  const mD2 = jp2(hd2(), ".sverklo", "models");
  if (!mE2(jp2(mD2, "model.onnx"))) {
    console.log("Downloading embedding model (~90MB)...");
    const { setupModels } = await import("../src/indexer/setup.js");
    await setupModels().catch(() => {});
  }

  const { getProjectConfig } = await import("../src/utils/config.js");
  const { Indexer } = await import("../src/indexer/indexer.js");
  const { enrichSymbolPurposes } = await import("../src/indexer/symbol-purpose.js");

  const config = getProjectConfig(projectPath);
  const indexer = new Indexer(config);
  await indexer.index();

  console.log(`Enriching top ${topN} symbols via ${model}${force ? " (forced)" : ""}...`);
  const r = await enrichSymbolPurposes(indexer, {
    topN,
    model,
    baseUrl,
    force,
    onProgress: (done, total, sym) => {
      if (done % 10 === 0 || done + 1 === total) {
        process.stdout.write(
          `  [${done + 1}/${total}] ${sym.slice(0, 40)}${done + 1 === total ? "\n" : "\r"}`
        );
      }
    },
  });

  console.log(`\nDone: ${r.enriched} enriched, ${r.skipped} skipped, ${r.failed} failed.`);
  if (r.failures.length > 0) {
    console.log("\nFailures (first 5):");
    for (const f of r.failures.slice(0, 5)) {
      console.log(`  - ${f.symbol}: ${f.reason}`);
    }
  }
  indexer.close();
  process.exit(r.failed > 0 && r.enriched === 0 ? 1 : 0);
}

if (command === "concept-index") {
  // Offline pass that labels every cluster with a short phrase + summary
  // via a locally-hosted Ollama chat model. Runs once per repo; later
  // runs skip clusters whose membership fingerprint hasn't changed.
  //
  //   sverklo concept-index
  //     [--model qwen2.5-coder:7b]
  //     [--base-url http://localhost:11434]
  //     [--force]
  //     [--max N]
  const flags = args.slice(1);
  const flagVal = (name: string, fallback?: string): string | undefined => {
    const idx = flags.indexOf(name);
    if (idx !== -1 && flags[idx + 1]) return flags[idx + 1];
    const prefixed = flags.find((f) => f.startsWith(`${name}=`));
    if (prefixed) return prefixed.slice(name.length + 1);
    return fallback;
  };

  const model = flagVal("--model", "qwen2.5-coder:7b")!;
  const baseUrl = flagVal("--base-url", "http://localhost:11434")!;
  const force = flags.includes("--force");
  const maxStr = flagVal("--max");
  const maxClusters = maxStr ? Number(maxStr) : undefined;

  const projectPath = await resolveProjectPath(flags);

  // Model check — needed for embedding the concept labels.
  const { existsSync: mExists } = await import("node:fs");
  const { join: jp } = await import("node:path");
  const { homedir: hdC } = await import("node:os");
  const mD = jp(hdC(), ".sverklo", "models");
  if (!mExists(jp(mD, "model.onnx"))) {
    console.log("Downloading embedding model (~90MB)...");
    const { setupModels } = await import("../src/indexer/setup.js");
    await setupModels().catch(() => {});
  }

  // Ollama reachability check up front — fail fast with a helpful message
  // before we spend time indexing.
  const reach = await fetch(`${baseUrl}/api/tags`).catch(() => null);
  if (!reach || !reach.ok) {
    console.error(
      `\n✗ Could not reach Ollama at ${baseUrl}.` +
        `\n\nTo fix:` +
        `\n  1. Install Ollama: https://ollama.com` +
        `\n  2. Pull a chat model:  ollama pull ${model}` +
        `\n  3. Start the daemon:   ollama serve   (or just \`ollama run ${model}\`)` +
        `\n\nThen re-run: sverklo concept-index\n`
    );
    process.exit(1);
  }

  const { getProjectConfig } = await import("../src/utils/config.js");
  const { Indexer } = await import("../src/indexer/indexer.js");
  const { detectClusters } = await import("../src/search/cluster.js");
  const { labelClusters } = await import("../src/indexer/concept-labeler.js");

  const config = getProjectConfig(projectPath);
  const indexer = new Indexer(config);
  await indexer.index();

  // Build clusters from the file graph.
  const files = indexer.fileStore.getAll().map((f) => ({
    id: f.id,
    path: f.path,
    pagerank: f.pagerank,
    language: f.language || "unknown",
  }));
  const edges = indexer.graphStore.getAll().map((e) => ({
    source: e.source_file_id,
    target: e.target_file_id,
    weight: e.reference_count,
  }));
  const clusters = detectClusters(files, edges);

  console.log(
    `Labeling ${maxClusters ? Math.min(maxClusters, clusters.length) : clusters.length} ` +
      `cluster(s) via ${model} at ${baseUrl}${force ? " (forced)" : ""}...`
  );

  const r = await labelClusters(indexer, clusters, indexer.conceptStore, {
    model,
    baseUrl,
    force,
    maxClusters,
    onProgress: (done, total, clusterId) => {
      if (done % 5 === 0 || done + 1 === total) {
        process.stdout.write(
          `  [${done + 1}/${total}] cluster ${clusterId}${done + 1 === total ? "\n" : "\r"}`
        );
      }
    },
  });

  console.log(`\nDone: ${r.labeled} labeled, ${r.skipped} skipped (unchanged), ${r.failed} failed.`);
  if (r.failures.length > 0) {
    console.log("\nFailures (first 5):");
    for (const f of r.failures.slice(0, 5)) {
      console.log(`  - cluster ${f.cluster_id}: ${f.reason}`);
    }
  }
  indexer.close();
  process.exit(r.failed > 0 && r.labeled === 0 ? 1 : 0);
}

if (command === "digest") {
  // Habit-loop scaffold: 5-line summary of what changed in this project
  // since the user last paid attention. Designed to be cheap to render
  // and easy to wire into a shell `cd` hook or a Slack post.
  //
  //   sverklo digest [--since 7d] [--format markdown|plain]
  const flags = args.slice(1);
  const flagVal = (name: string): string | undefined => {
    const idx = flags.indexOf(name);
    if (idx !== -1 && flags[idx + 1]) return flags[idx + 1];
    const prefixed = flags.find((f) => f.startsWith(`${name}=`));
    return prefixed ? prefixed.slice(name.length + 1) : undefined;
  };

  // Parse --since: accept "7d", "30d", or a bare number (interpreted as days).
  const sinceRaw = flagVal("--since") ?? "7d";
  const sinceMatch = /^(\d+)d?$/.exec(sinceRaw);
  if (!sinceMatch) {
    console.error(`✗ --since expects N or Nd (e.g. 7 or 7d), got "${sinceRaw}"`);
    process.exit(2);
  }
  const sinceDays = parseInt(sinceMatch[1], 10);

  const formatRaw = flagVal("--format") ?? "markdown";
  if (formatRaw !== "markdown" && formatRaw !== "plain") {
    console.error(`✗ --format must be markdown or plain, got "${formatRaw}"`);
    process.exit(2);
  }

  // Strip value-taking flags so the bare "7" in `--since 7` isn't
  // mistaken for a positional project path.
  const consumedFlags = new Set(["--since", "--format"]);
  const cleanFlags: string[] = [];
  for (let i = 0; i < flags.length; i++) {
    if (consumedFlags.has(flags[i])) {
      i++; // skip the value too
      continue;
    }
    if (Array.from(consumedFlags).some((f) => flags[i].startsWith(`${f}=`))) continue;
    cleanFlags.push(flags[i]);
  }
  const projectPath = await resolveProjectPath(cleanFlags);
  const { getProjectConfig } = await import("../src/utils/config.js");
  const { Indexer } = await import("../src/indexer/indexer.js");
  const { generateDigest } = await import("../src/digest.js");

  const config = getProjectConfig(projectPath);
  const indexer = new Indexer(config);
  await indexer.index();
  console.log(generateDigest(indexer, { sinceDays, format: formatRaw }));
  indexer.close();
  process.exit(0);
}

if (command === "prune") {
  // Sprint 9-C: access-decay pruning + episodic consolidation. Pure
  // bookkeeping pass over the memory store; never deletes (uses bi-
  // temporal supersedes-by). LLM distillation is opt-in via --with-ollama.
  //
  //   sverklo prune
  //     [--dry-run]
  //     [--max-age-days N]            (default 30)
  //     [--stale-threshold X]         (default 0.05)
  //     [--similarity-threshold X]    (default 0.88)
  //     [--min-cluster-size N]        (default 3)
  //     [--with-ollama --model X --base-url URL]
  const flags = args.slice(1);

  if (flags.includes("--help") || flags.includes("-h")) {
    console.log(
      `\nsverklo prune — decay stale memories + consolidate similar episodic ones (offline)\n\n` +
      `Usage:\n` +
      `  sverklo prune [flags]\n\n` +
      `Flags:\n` +
      `  --dry-run                      report what would change without writing\n` +
      `  --max-age-days N               consolidate episodic memories older than N (default 30)\n` +
      `  --stale-threshold X            decay-score cutoff below which a memory is marked stale (default 0.05)\n` +
      `  --similarity-threshold X       cosine threshold for clustering (0..1, default 0.88)\n` +
      `  --min-cluster-size N           smallest cluster that triggers consolidation (default 3)\n` +
      `  --with-ollama                  use Ollama to distil cluster summaries (falls back to deterministic note)\n` +
      `  --model NAME                   Ollama model id (default qwen2.5-coder:7b)\n` +
      `  --base-url URL                 Ollama base URL (default http://localhost:11434)\n` +
      `  -h, --help                     show this help\n\n` +
      `Notes:\n` +
      `  Originals are never deleted — superseded memories keep their lineage via valid_until_sha\n` +
      `  and superseded_by, so timeline views stay intact.\n`
    );
    process.exit(0);
  }

  const flagVal = (name: string): string | undefined => {
    const idx = flags.indexOf(name);
    if (idx !== -1 && flags[idx + 1]) return flags[idx + 1];
    const prefixed = flags.find((f) => f.startsWith(`${name}=`));
    if (prefixed) return prefixed.slice(name.length + 1);
    return undefined;
  };
  const num = (name: string, predicate: (n: number) => boolean): number | undefined => {
    const v = flagVal(name);
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isFinite(n) || !predicate(n)) {
      console.error(`\n✗ ${name} expects a valid number (got "${v}")\n`);
      process.exit(2);
    }
    return n;
  };

  const projectPath = await resolveProjectPath(flags);
  const { getProjectConfig } = await import("../src/utils/config.js");
  const { Indexer } = await import("../src/indexer/indexer.js");
  const { runPrune } = await import("../src/memory/prune.js");

  // When --with-ollama is set, fail fast if the daemon isn't reachable
  // — same contract as `concept-index`. Otherwise the user thinks
  // distillation ran when it silently fell back to the deterministic
  // summary (or did nothing because no clusters existed).
  const withOllama = flags.includes("--with-ollama");
  const ollamaBaseUrl = flagVal("--base-url") ?? "http://localhost:11434";
  if (withOllama) {
    const reach = await fetch(`${ollamaBaseUrl}/api/tags`).catch(() => null);
    if (!reach || !reach.ok) {
      console.error(
        `\n✗ --with-ollama set but ${ollamaBaseUrl} is unreachable.` +
          `\n  Start Ollama (\`ollama serve\`) or drop --with-ollama to use the deterministic summary.\n`
      );
      process.exit(1);
    }
  }

  const config = getProjectConfig(projectPath);
  const indexer = new Indexer(config);
  await indexer.index();

  const report = await runPrune(indexer, {
    dryRun: flags.includes("--dry-run"),
    maxAgeDays: num("--max-age-days", (n) => n > 0),
    staleScoreThreshold: num("--stale-threshold", (n) => n >= 0),
    similarityThreshold: num("--similarity-threshold", (n) => n > 0 && n <= 1),
    minClusterSize: num("--min-cluster-size", (n) => n >= 2),
    withOllama,
    ollamaModel: flagVal("--model"),
    ollamaBaseUrl: flagVal("--base-url"),
  });

  console.log(
    `\n${report.dryRun ? "[dry-run] " : ""}Memory prune complete:\n` +
      `  scanned:               ${report.scanned}${report.truncated ? ` (of ${report.totalActive} active — capped)` : ""}\n` +
      `  marked stale (decay):  ${report.decayed}\n` +
      `  clusters consolidated: ${report.consolidatedClusters}\n` +
      `  members superseded:    ${report.consolidatedMembers}\n` +
      (report.newSemanticMemoryIds.length > 0
        ? `  new semantic ids:      ${report.newSemanticMemoryIds.join(", ")}\n`
        : "") +
      (report.truncated
        ? `\n⚠ Only the ${report.scanned} most-recent memories were scanned. Re-run from a smaller working set or wait for a future flag to lift this cap.\n`
        : "")
  );

  indexer.close();
  process.exit(0);
}

if (command === "--help" || command === "-h") {
  console.log(`
sverklo — code intelligence for AI agents

Usage:
  sverklo init               Set up sverklo in your project (.mcp.json + CLAUDE.md)
  sverklo doctor             Diagnose MCP setup issues
  sverklo [project-path]     Start the MCP server (stdio transport, single project)
  sverklo                    Start in global mode (serves all registered repos)
  sverklo register [path]    Add a directory to the global registry
  sverklo unregister <name>  Remove a repo from the global registry
  sverklo list               List all registered repositories
  sverklo workspace <subcmd> Manage cross-repo workspaces (see \`workspace --help\`)

Audit / review:
  sverklo audit [path]       Run codebase audit and emit a graded report
  sverklo review             Run risk-scored diff review (CI-friendly; auto-detects PR ref)
  sverklo audit-prompt       Print a ready-to-paste codebase-audit prompt (hybrid workflow)
  sverklo review-prompt      Print a ready-to-paste PR/MR-review prompt (hybrid workflow)
  sverklo history            Show audit grade history and trend over time
  sverklo bench              Run reproducible benchmarks on gin/nestjs/react (checkout only)

Memory + offline maintenance:
  sverklo wakeup             Print compressed project context (for system-prompt injection)
  sverklo wiki               Generate a markdown wiki from the indexed codebase
  sverklo digest             5-line summary of what changed in this project (--since 7d)
  sverklo prune              Decay stale memories + consolidate similar episodic ones
  sverklo concept-index      Label clusters with an LLM (requires Ollama)
  sverklo enrich-symbols     Add LLM-generated purpose to top-PageRank symbols (requires Ollama)
  sverklo enrich-patterns    Tag top-PageRank symbols with design patterns (requires Ollama)

Setup / runtime:
  sverklo setup              Download the embedding model (~90MB)
  sverklo setup --global     Write global MCP config for Claude Code (multi-repo)
  sverklo ui [project-path]  Open the web dashboard
  sverklo activity           Show recent activity log (always-on audit trail)
  sverklo trace              Show recent tool call traces (set SVERKLO_TRACE=1)
  sverklo telemetry <subcmd> Manage opt-in telemetry (off by default)
  sverklo --help             Show this help

Quick start (single project):
  npm install -g sverklo
  cd your-project && sverklo init
  claude   # start coding — sverklo tools are preferred automatically

Quick start (multi-repo, global):
  sverklo register /path/to/project-a
  sverklo register /path/to/project-b
  sverklo setup --global    # writes ~/.claude/settings.json
  claude                    # sverklo serves both repos via one MCP server

Environment:
  SVERKLO_DEBUG=1   Enable debug logging to stderr
`);
  process.exit(0);
}

// Issue #12: runtime mode resolution. Embedded is the default and does
// what sverklo has always done. Shared and cloud are reserved names
// that print a clear "not yet implemented" message.
const { resolveMode, notYetImplemented, SverkloModeError } = await import("../src/modes.js");
let modeResolution;
try {
  modeResolution = resolveMode(args);
} catch (err) {
  if (err instanceof SverkloModeError) {
    console.error(err.message);
    process.exit(2);
  }
  throw err;
}

if (modeResolution.mode !== "embedded") {
  process.stderr.write(notYetImplemented(modeResolution.mode));
  process.exit(2);
}

// Strip any --mode=... arg before resolving the project path so it
// doesn't get treated as a directory name.
const positionalArgs = args.filter((a) => !a.startsWith("--mode=") && !a.startsWith("--global"));
const hasExplicitPath = positionalArgs.length > 0 && positionalArgs[0] !== undefined;
const isGlobalFlag = args.includes("--global");

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

// Global mode: when no project path is given (or --global is passed),
// check if the registry has repos and start the multi-repo MCP server.
if (isGlobalFlag || !hasExplicitPath) {
  const { getRegistry } = await import("../src/registry/registry.js");
  const repos = getRegistry();
  const repoCount = Object.keys(repos).length;

  if (repoCount > 0 || isGlobalFlag) {
    // Start in global (multi-repo) mode
    const { startGlobalMcpServer } = await import("../src/index.js");
    startGlobalMcpServer().catch((err) => {
      console.error("Failed to start sverklo (global mode):", err);
      process.exit(1);
    });
  } else {
    // No repos registered and no path given — fall through to single-project mode
    // using cwd, matching the original behavior.
    const rootPath = resolve(process.cwd());
    const { startMcpServer } = await import("../src/index.js");
    startMcpServer(rootPath).catch((err) => {
      console.error("Failed to start sverklo:", err);
      process.exit(1);
    });
  }
} else {
  // Single-project mode (backward compatible)
  const rootPath = resolve(positionalArgs[0]);
  const { startMcpServer } = await import("../src/index.js");
  startMcpServer(rootPath).catch((err) => {
    console.error("Failed to start sverklo:", err);
    process.exit(1);
  });
}

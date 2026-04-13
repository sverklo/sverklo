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

  const projectPath = resolve(process.cwd());

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

if (command === "audit") {
  // CLI audit subcommand: indexes the repo, runs audit analysis,
  // outputs markdown, HTML, or JSON.
  //
  //   sverklo audit [--format markdown|html|json] [--output <path>] [--open]

  const flags = args.slice(1);
  const flagVal = (name: string, fallback: string): string => {
    const idx = flags.indexOf(name);
    return idx !== -1 && flags[idx + 1] ? flags[idx + 1] : fallback;
  };

  const format = flagVal("--format", "markdown") as "markdown" | "html" | "json";
  const outputPath = flagVal("--output", format === "html" ? "sverklo-audit.html" : "");
  const shouldOpen = flags.includes("--open");

  const projectPath = resolve(process.cwd());

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

  const mdOutput = handleAudit(indexer, { token_budget: 16000 });
  indexer.close();

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

if (command === "--help" || command === "-h") {
  console.log(`
sverklo — code intelligence for AI agents

Usage:
  sverklo init              Set up sverklo in your project (.mcp.json + CLAUDE.md)
  sverklo doctor            Diagnose MCP setup issues
  sverklo [project-path]    Start the MCP server (stdio transport)
  sverklo ui [project-path] Open the web dashboard
  sverklo wakeup            Print compressed project context (for system-prompt injection)
  sverklo bench             Run reproducible benchmarks on gin/nestjs/react (checkout only)
  sverklo audit-prompt      Print a ready-to-paste codebase-audit prompt (hybrid workflow)
  sverklo review-prompt     Print a ready-to-paste PR/MR-review prompt (hybrid workflow)
  sverklo setup             Download the embedding model (~90MB)
  sverklo telemetry         Manage opt-in telemetry (off by default)
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
const positionalArgs = args.filter((a) => !a.startsWith("--mode="));
const rootPath = resolve(positionalArgs[0] || process.cwd());

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

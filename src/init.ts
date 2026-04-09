import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import { track, hasBeenNudged, markNudged } from "./telemetry/index.js";

const CLAUDE_MD_SNIPPET = `
## Sverklo — Code Intelligence

Sverklo is a sharper tool for specific kinds of work. Use it where it fits, not as a blanket replacement for Grep/Read.

**Use sverklo for:**
- \`sverklo_search\` — exploratory questions where you don't know the exact symbol ("how does auth work", "find anything related to billing")
- \`sverklo_impact\` — refactor blast radius (who calls this function)
- \`sverklo_refs\` — all references to a symbol
- \`sverklo_deps\` — file dependency graph (imports + importers)
- \`sverklo_lookup\` — find function/class definitions by name
- \`sverklo_overview\` — high-level codebase map (PageRank-ranked)
- \`sverklo_audit\` — god nodes, hub files, dead code candidates
- \`sverklo_remember\` / \`sverklo_recall\` — persist decisions across sessions

**Prefer Grep/Read for:**
- Exact string matches and literal patterns
- Reading specific file contents or line ranges
- Focused diff review where you know which files matter
`;

/**
 * Resolve the absolute path to the sverklo binary.
 * Using a full path is more reliable than relying on PATH inheritance
 * when Claude Code spawns the subprocess.
 */
function resolveSverkloBinary(): string {
  try {
    return execSync("command -v sverklo", { encoding: "utf-8" }).trim() || "sverklo";
  } catch {
    return "sverklo";
  }
}

function buildAutoCaptureHook() {
  // PostToolUse hook — nudge Claude to capture decisions after Edit/Write tool calls.
  // The hook output is visible to Claude, who decides whether to call sverklo_remember.
  // Cheap, non-blocking, model-driven (no heuristic false positives).
  return {
    matcher: "Edit|Write|NotebookEdit",
    hooks: [
      {
        type: "command",
        command:
          "echo 'If this edit represents a design decision, architectural choice, or pattern worth remembering, call sverklo_remember to save it. Skip if it is a routine fix.'",
        timeout: 3,
      },
    ],
  };
}

export async function initProject(
  projectPath: string,
  options: { autoCapture?: boolean; mineChats?: boolean } = {}
): Promise<void> {
  console.log("Initializing Sverklo in", projectPath);
  console.log("");

  // 1. Add CLAUDE.md snippet
  const claudeMdPath = join(projectPath, "CLAUDE.md");
  if (existsSync(claudeMdPath)) {
    const content = readFileSync(claudeMdPath, "utf-8");
    if (content.includes("sverklo_search")) {
      console.log("  CLAUDE.md — already has sverklo instructions, skipping");
    } else {
      writeFileSync(claudeMdPath, content + "\n" + CLAUDE_MD_SNIPPET);
      console.log("  CLAUDE.md — appended sverklo instructions");
    }
  } else {
    writeFileSync(claudeMdPath, CLAUDE_MD_SNIPPET.trim() + "\n");
    console.log("  CLAUDE.md — created with sverklo instructions");
  }

  // 2. MCP server config — Claude Code reads .mcp.json AT PROJECT ROOT for project-scoped servers.
  //    .claude/mcp.json is NOT read by Claude Code (verified Apr 2026).
  const mcpConfigPath = join(projectPath, ".mcp.json");
  const sverkloBin = resolveSverkloBinary();

  let mcpConfig: { mcpServers?: Record<string, { command: string; args: string[] }> } = {};
  if (existsSync(mcpConfigPath)) {
    try {
      mcpConfig = JSON.parse(readFileSync(mcpConfigPath, "utf-8"));
    } catch {
      mcpConfig = {};
    }
  }

  if (mcpConfig.mcpServers?.sverklo) {
    console.log("  .mcp.json — sverklo already configured, skipping");
  } else {
    if (!mcpConfig.mcpServers) mcpConfig.mcpServers = {};
    mcpConfig.mcpServers.sverklo = {
      command: sverkloBin,
      args: ["."],
    };
    writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2) + "\n");
    console.log(`  .mcp.json — added sverklo MCP server (${sverkloBin})`);
  }

  // 3. Auto-allow sverklo MCP tools in .claude/settings.local.json so Claude Code
  //    doesn't prompt for permission every time it calls a sverklo tool.
  //    Pattern: mcp__sverklo__<tool-name> — wildcard supported.
  //    Also adds optional auto-capture hook if --auto-capture was passed.
  const claudeDir = join(projectPath, ".claude");
  const settingsPath = join(claudeDir, "settings.local.json");
  mkdirSync(claudeDir, { recursive: true });

  type Settings = {
    permissions?: { allow?: string[]; deny?: string[] };
    hooks?: Record<string, unknown[]>;
  };

  let settings: Settings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    } catch {
      settings = {};
    }
  }

  // Add sverklo wildcard to permissions.allow (idempotent)
  if (!settings.permissions) settings.permissions = {};
  if (!settings.permissions.allow) settings.permissions.allow = [];

  const SVERKLO_PATTERN = "mcp__sverklo__*";
  const allowList = settings.permissions.allow;
  const hasSverklo = allowList.some(
    (p) => p === SVERKLO_PATTERN || p === "mcp__sverklo" || p.startsWith("mcp__sverklo__")
  );

  let settingsChanged = false;
  if (!hasSverklo) {
    allowList.push(SVERKLO_PATTERN);
    settingsChanged = true;
  }

  if (options.autoCapture) {
    if (!settings.hooks) settings.hooks = {};
    if (!settings.hooks.PostToolUse) settings.hooks.PostToolUse = [];

    const existingPost = settings.hooks.PostToolUse as Array<{ hooks?: Array<{ command?: string }> }>;
    const alreadyHasAutoCapture = existingPost.some((h) =>
      h.hooks?.some((hook) => hook.command?.includes("sverklo_remember"))
    );

    if (!alreadyHasAutoCapture) {
      existingPost.push(buildAutoCaptureHook() as unknown as { hooks?: Array<{ command?: string }> });
      settingsChanged = true;
    }
  }

  if (settingsChanged) {
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    const bits: string[] = [];
    if (!hasSverklo) bits.push("auto-allow for sverklo tools");
    if (options.autoCapture) bits.push("PostToolUse auto-capture hook");
    console.log(`  .claude/settings.local.json — added ${bits.join(" + ")}`);
  } else {
    console.log("  .claude/settings.local.json — sverklo permissions already set");
  }

  // 3.5 Google Antigravity — global MCP config at ~/.gemini/antigravity/mcp_config.json.
  //     Antigravity has NO per-project MCP config (verified Apr 2026, Google forum
  //     feature request open). So this is a one-time-per-machine wiring, not per-project,
  //     but we still write it from `init` because it's the lowest-friction moment to do it.
  //     Schema mirrors Claude Desktop / Cursor (mcpServers + command/args/env).
  const antigravityDir = join(homedir(), ".gemini", "antigravity");
  if (existsSync(antigravityDir)) {
    const antigravityConfigPath = join(antigravityDir, "mcp_config.json");
    type AgConfig = {
      mcpServers?: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
    };
    let agConfig: AgConfig = {};
    if (existsSync(antigravityConfigPath)) {
      try {
        agConfig = JSON.parse(readFileSync(antigravityConfigPath, "utf-8"));
      } catch {
        agConfig = {};
      }
    }
    if (agConfig.mcpServers?.sverklo) {
      console.log("  ~/.gemini/antigravity/mcp_config.json — sverklo already configured");
    } else {
      if (!agConfig.mcpServers) agConfig.mcpServers = {};
      // Antigravity's global config doesn't know about the per-project root, so we
      // pass the absolute project path explicitly. Users with multiple projects
      // will need to re-run `sverklo init` from each (or hand-edit).
      agConfig.mcpServers.sverklo = {
        command: sverkloBin,
        args: [projectPath],
      };
      writeFileSync(antigravityConfigPath, JSON.stringify(agConfig, null, 2) + "\n");
      console.log(`  ~/.gemini/antigravity/mcp_config.json — added sverklo (project: ${projectPath})`);
      console.log("    Restart Antigravity to pick up the new MCP server.");
    }
  }

  // 4. Migrate legacy .claude/mcp.json if present (from older sverklo versions)
  const legacyMcpPath = join(projectPath, ".claude", "mcp.json");
  if (existsSync(legacyMcpPath)) {
    try {
      const legacy = JSON.parse(readFileSync(legacyMcpPath, "utf-8"));
      if (legacy?.mcpServers?.sverklo) {
        console.log("  .claude/mcp.json — found legacy config (Claude Code does not read this — moved to .mcp.json)");
      }
    } catch {}
  }

  // 5. Import existing memories from CLAUDE.md, ADRs, etc.
  console.log("");
  console.log("Scanning for existing project knowledge...");
  try {
    const { existsSync: fsExists } = await import("node:fs");
    const { join: pjoin } = await import("node:path");
    const { homedir } = await import("node:os");
    const modelDir = pjoin(homedir(), ".sverklo", "models");

    if (fsExists(pjoin(modelDir, "model.onnx"))) {
      const { getProjectConfig } = await import("./utils/config.js");
      const { Indexer } = await import("./indexer/indexer.js");
      const { importExistingMemories } = await import("./memory/import.js");

      const config = getProjectConfig(projectPath);
      const indexer = new Indexer(config);
      const result = await importExistingMemories(indexer, projectPath, {
        mineChats: options.mineChats ?? false,
      });
      indexer.close();

      if (result.imported > 0) {
        console.log(`  imported ${result.imported} memories from:`);
        for (const src of result.sources) {
          console.log(`    · ${src}`);
        }
        if (result.skipped > 0) {
          console.log(`  (${result.skipped} duplicates skipped)`);
        }
      } else {
        const hint = options.mineChats
          ? "  no CLAUDE.md, .cursorrules, ADRs, or matching Claude Code chats found — skipping"
          : "  no CLAUDE.md, .cursorrules, or ADRs found — skipping";
        console.log(hint);
      }
    } else {
      console.log("  model not yet downloaded — memories will be imported on first run");
    }
  } catch (err) {
    console.log("  (memory import skipped)");
  }

  // 6. Run doctor to verify everything is set up correctly.
  //    This catches subtle issues immediately so the user doesn't restart
  //    Claude Code only to find sverklo isn't loading.
  console.log("");
  try {
    const { runDoctor } = await import("./doctor.js");
    runDoctor(projectPath);
  } catch {
    // Doctor failures are non-fatal — init still succeeded
  }

  // 7. Telemetry detection events (only sent if user has opted in;
  //    track() is a hard short-circuit no-op otherwise).
  void track("init.run");
  if (existsSync(join(projectPath, ".mcp.json"))) {
    void track("init.detected.claude-code");
  }
  if (existsSync(join(projectPath, ".cursor", "mcp.json"))) {
    void track("init.detected.cursor");
  }
  if (existsSync(join(homedir(), ".windsurf", "mcp.json"))) {
    void track("init.detected.windsurf");
  }
  if (existsSync(join(projectPath, ".vscode", "mcp.json"))) {
    void track("init.detected.vscode");
  }
  if (existsSync(join(homedir(), ".gemini", "antigravity"))) {
    void track("init.detected.antigravity");
  }

  // 8. First-run nudge: ask once whether the user wants to opt in. Stored in
  //    ~/.sverklo/init-nudged so it never asks again, even across projects.
  //    Stays one line to avoid feeling pushy.
  if (!hasBeenNudged()) {
    console.log("");
    console.log(
      "Telemetry is OFF. To help us prioritize fixes, opt in with:  sverklo telemetry enable"
    );
    console.log(
      "What gets collected (and what doesn't) is documented at github.com/sverklo/sverklo/blob/main/TELEMETRY.md"
    );
    markNudged();
  }

  console.log("");
  console.log("Restart Claude Code in this directory and sverklo will appear in /mcp.");
  // Next-steps footer: make the dashboard visible without forcing it.
  // Users in CI / SSH / headless environments ignore this; users who
  // want a visual explorer have a one-command path.
  console.log("");
  console.log("Next steps:");
  console.log("  claude                # start coding — sverklo tools are preferred automatically");
  console.log("  sverklo ui             # optional: open the web dashboard for visual exploration");
  console.log("                          (dependency graph, search playground, memory viewer)");
}

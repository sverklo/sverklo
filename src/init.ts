import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const CLAUDE_MD_SNIPPET = `
## Sverklo — Code Intelligence

When sverklo MCP server is connected, **always prefer sverklo tools over built-in grep/search**:

- \`sverklo_search\` — semantic code search (use instead of Grep/ripgrep)
- \`sverklo_overview\` — understand project structure (use instead of listing files)
- \`sverklo_lookup\` — find any function/class/type by name
- \`sverklo_refs\` — find all references to a symbol
- \`sverklo_deps\` — show file dependency graph
- \`sverklo_remember\` — save important decisions and patterns
- \`sverklo_recall\` — check past decisions before making new ones
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

  // 3. Optional auto-capture hook in .claude/settings.local.json
  //    NOTE: We no longer write a fake "Sverklo is connected" SessionStart hook —
  //    that masked real connection failures. Claude Code's normal MCP loading
  //    surfaces actual errors when .mcp.json is correct.
  if (options.autoCapture) {
    const claudeDir = join(projectPath, ".claude");
    const settingsPath = join(claudeDir, "settings.local.json");
    mkdirSync(claudeDir, { recursive: true });

    let settings: { hooks?: Record<string, unknown[]> } = {};
    if (existsSync(settingsPath)) {
      try {
        settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
      } catch {
        settings = {};
      }
    }

    if (!settings.hooks) settings.hooks = {};
    if (!settings.hooks.PostToolUse) settings.hooks.PostToolUse = [];

    const existingPost = settings.hooks.PostToolUse as Array<{ hooks?: Array<{ command?: string }> }>;
    const alreadyHasSverklo = existingPost.some((h) =>
      h.hooks?.some((hook) => hook.command?.includes("sverklo_remember"))
    );

    if (alreadyHasSverklo) {
      console.log("  .claude/settings.local.json — auto-capture hook already present, skipping");
    } else {
      existingPost.push(buildAutoCaptureHook() as unknown as { hooks?: Array<{ command?: string }> });
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
      console.log("  .claude/settings.local.json — added PostToolUse auto-capture hook");
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

  console.log("");
  console.log("Done. Restart Claude Code in this directory and sverklo should appear in /mcp.");
  console.log("If it doesn't load, run `sverklo doctor` to diagnose.");
}

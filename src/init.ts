import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
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

const HOOKS_CONFIG = {
  hooks: {
    SessionStart: [
      {
        matcher: "",
        hooks: [
          {
            type: "command",
            command:
              "echo 'Sverklo is connected. Use sverklo_search for code search (semantic, ranked by importance — better than grep). Use sverklo_remember to save decisions. Use sverklo_recall to check past decisions.'",
            timeout: 5,
          },
        ],
      },
    ],
  },
};

export async function initProject(projectPath: string): Promise<void> {
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

  // 2. Add hooks to .claude/settings.local.json
  const claudeDir = join(projectPath, ".claude");
  const settingsPath = join(claudeDir, "settings.local.json");

  mkdirSync(claudeDir, { recursive: true });

  let settings: any = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    } catch {
      settings = {};
    }
  }

  // Check if hook already exists
  const existingHooks = settings.hooks?.SessionStart;
  const alreadyHasSverklo = existingHooks?.some((h: any) =>
    h.hooks?.some((hook: any) => hook.command?.includes("sverklo") || hook.command?.includes("Sverklo"))
  );

  if (alreadyHasSverklo) {
    console.log("  .claude/settings.local.json — already has sverklo hooks, skipping");
  } else {
    // Merge hooks
    if (!settings.hooks) settings.hooks = {};
    if (!settings.hooks.SessionStart) settings.hooks.SessionStart = [];
    settings.hooks.SessionStart.push(...HOOKS_CONFIG.hooks.SessionStart);
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    console.log("  .claude/settings.local.json — added SessionStart hook");
  }

  // 3. Add MCP server config if not present
  const mcpConfigPath = join(claudeDir, "mcp.json");
  let mcpConfig: any = {};
  if (existsSync(mcpConfigPath)) {
    try {
      mcpConfig = JSON.parse(readFileSync(mcpConfigPath, "utf-8"));
    } catch {
      mcpConfig = {};
    }
  }

  if (mcpConfig.mcpServers?.sverklo) {
    console.log("  .claude/mcp.json — sverklo already configured, skipping");
  } else {
    if (!mcpConfig.mcpServers) mcpConfig.mcpServers = {};
    mcpConfig.mcpServers.sverklo = {
      command: "sverklo",
      args: ["."],
    };
    writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2) + "\n");
    console.log("  .claude/mcp.json — added sverklo MCP server");
  }

  // 4. Import existing memories from CLAUDE.md, ADRs, etc.
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
      const result = await importExistingMemories(indexer, projectPath);
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
        console.log("  no CLAUDE.md, .cursorrules, or ADRs found — skipping");
      }
    } else {
      console.log("  model not yet downloaded — memories will be imported on first run");
    }
  } catch (err) {
    console.log("  (memory import skipped)");
  }

  console.log("");
  console.log("Done! Sverklo is now configured for this project.");
  console.log("Start Claude Code and sverklo tools will be preferred automatically.");
}

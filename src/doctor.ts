import { existsSync, readFileSync, statSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";

interface CheckResult {
  name: string;
  status: "ok" | "warn" | "fail";
  message: string;
  fix?: string;
}

export function runDoctor(projectPath: string): void {
  const checks: CheckResult[] = [];

  // 1. Binary on PATH
  let sverkloBin: string | null = null;
  try {
    sverkloBin = execSync("command -v sverklo", { encoding: "utf-8" }).trim();
    checks.push({
      name: "sverklo binary",
      status: "ok",
      message: sverkloBin,
    });
  } catch {
    checks.push({
      name: "sverklo binary",
      status: "fail",
      message: "not found on PATH",
      fix: "npm install -g sverklo",
    });
  }

  // 2. Version
  if (sverkloBin) {
    try {
      const version = execSync(`${sverkloBin} --version`, { encoding: "utf-8" }).trim();
      checks.push({
        name: "version",
        status: "ok",
        message: version,
      });
    } catch (err) {
      checks.push({
        name: "version",
        status: "fail",
        message: "failed to run --version",
      });
    }
  }

  // 3. ONNX model
  const modelPath = join(homedir(), ".sverklo", "models", "model.onnx");
  if (existsSync(modelPath)) {
    const size = statSync(modelPath).size;
    checks.push({
      name: "embedding model",
      status: "ok",
      message: `${(size / 1024 / 1024).toFixed(0)}MB at ~/.sverklo/models/model.onnx`,
    });
  } else {
    checks.push({
      name: "embedding model",
      status: "warn",
      message: "not downloaded yet (will auto-download on first MCP tool call)",
      fix: "sverklo setup",
    });
  }

  // 4. .mcp.json at PROJECT ROOT (the only place Claude Code reads)
  const mcpPath = join(projectPath, ".mcp.json");
  if (existsSync(mcpPath)) {
    try {
      const mcp = JSON.parse(readFileSync(mcpPath, "utf-8"));
      if (mcp.mcpServers?.sverklo) {
        const cmd = mcp.mcpServers.sverklo.command;
        if (cmd === "sverklo" || cmd?.endsWith("/sverklo")) {
          checks.push({
            name: ".mcp.json (project root)",
            status: "ok",
            message: `sverklo configured: ${cmd}`,
          });
        } else {
          checks.push({
            name: ".mcp.json (project root)",
            status: "warn",
            message: `command is "${cmd}" — may not resolve in subprocess`,
            fix: "Use full path: " + (sverkloBin || "/path/to/sverklo"),
          });
        }
      } else {
        checks.push({
          name: ".mcp.json (project root)",
          status: "fail",
          message: "exists but does not configure sverklo",
          fix: "sverklo init",
        });
      }
    } catch {
      checks.push({
        name: ".mcp.json (project root)",
        status: "fail",
        message: "exists but is invalid JSON",
        fix: "Delete .mcp.json and run: sverklo init",
      });
    }
  } else {
    checks.push({
      name: ".mcp.json (project root)",
      status: "fail",
      message: "missing — Claude Code will not load sverklo",
      fix: "sverklo init",
    });
  }

  // 4b. Google Antigravity (optional) — only check if Antigravity dir exists.
  //     Antigravity uses ~/.gemini/antigravity/mcp_config.json (global, no per-project).
  //     Silent skip when Antigravity isn't installed; users on other clients shouldn't
  //     see noise about a tool they don't use.
  const antigravityDir = join(homedir(), ".gemini", "antigravity");
  if (existsSync(antigravityDir)) {
    const agConfigPath = join(antigravityDir, "mcp_config.json");
    if (existsSync(agConfigPath)) {
      try {
        const ag = JSON.parse(readFileSync(agConfigPath, "utf-8"));
        const sv = ag?.mcpServers?.sverklo;
        if (sv?.command && Array.isArray(sv.args)) {
          // Antigravity has no per-project config, so the args[] path tells us
          // which project this user wired up. Warn if it's not the current one.
          const wiredPath = sv.args[0];
          if (wiredPath === projectPath) {
            checks.push({
              name: "Antigravity MCP config",
              status: "ok",
              message: "sverklo wired to this project",
            });
          } else {
            checks.push({
              name: "Antigravity MCP config",
              status: "warn",
              message: `sverklo is wired to ${wiredPath} (not this project)`,
              fix: "sverklo init (rewrites Antigravity config to current project)",
            });
          }
        } else {
          checks.push({
            name: "Antigravity MCP config",
            status: "warn",
            message: "exists but sverklo not configured",
            fix: "sverklo init",
          });
        }
      } catch {
        checks.push({
          name: "Antigravity MCP config",
          status: "warn",
          message: "mcp_config.json exists but is invalid JSON",
        });
      }
    } else {
      checks.push({
        name: "Antigravity MCP config",
        status: "warn",
        message: "Antigravity is installed but mcp_config.json missing",
        fix: "sverklo init",
      });
    }
  }

  // 5. Legacy .claude/mcp.json (does NOT work — flag it)
  const legacyMcp = join(projectPath, ".claude", "mcp.json");
  if (existsSync(legacyMcp)) {
    checks.push({
      name: ".claude/mcp.json (legacy)",
      status: "warn",
      message: "this file exists but Claude Code does NOT read it",
      fix: "config moved to .mcp.json at project root — safe to delete",
    });
  }

  // 5b. .claude/settings.local.json — permission auto-allow
  const settingsPath = join(projectPath, ".claude", "settings.local.json");
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
      const allow: string[] = settings.permissions?.allow || [];
      const hasSverklo = allow.some(
        (p: string) =>
          p === "mcp__sverklo__*" ||
          p === "mcp__sverklo" ||
          p.startsWith("mcp__sverklo__")
      );
      if (hasSverklo) {
        checks.push({
          name: "permissions auto-allow",
          status: "ok",
          message: "sverklo tools won't prompt for approval",
        });
      } else {
        checks.push({
          name: "permissions auto-allow",
          status: "warn",
          message: "Claude Code will prompt before each sverklo tool call",
          fix: "sverklo init (adds mcp__sverklo__* to allow list)",
        });
      }
    } catch {
      checks.push({
        name: "permissions auto-allow",
        status: "warn",
        message: "settings.local.json is invalid JSON",
      });
    }
  } else {
    checks.push({
      name: "permissions auto-allow",
      status: "warn",
      message: "no settings.local.json — Claude Code will prompt for each tool call",
      fix: "sverklo init",
    });
  }

  // 6. CLAUDE.md
  const claudeMdPath = join(projectPath, "CLAUDE.md");
  if (existsSync(claudeMdPath)) {
    const content = readFileSync(claudeMdPath, "utf-8");
    if (content.includes("sverklo_search")) {
      checks.push({
        name: "CLAUDE.md",
        status: "ok",
        message: "contains sverklo instructions",
      });
    } else {
      checks.push({
        name: "CLAUDE.md",
        status: "warn",
        message: "exists but does not mention sverklo",
        fix: "sverklo init (will append instructions)",
      });
    }
  } else {
    checks.push({
      name: "CLAUDE.md",
      status: "warn",
      message: "missing — agents will not know to prefer sverklo over grep",
      fix: "sverklo init",
    });
  }

  // 7. MCP handshake (actually try to talk to the server)
  if (sverkloBin) {
    try {
      const result = spawnSync(
        sverkloBin,
        ["."],
        {
          input:
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "initialize",
              params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: { name: "sverklo-doctor", version: "1.0" },
              },
            }) + "\n",
          encoding: "utf-8",
          cwd: projectPath,
          timeout: 8000,
          maxBuffer: 1024 * 1024,
        }
      );

      const out = result.stdout || "";
      const firstLine = out.split("\n").find((l) => l.trim());
      if (firstLine) {
        try {
          const parsed = JSON.parse(firstLine);
          if (parsed.result?.serverInfo?.name === "sverklo") {
            checks.push({
              name: "MCP handshake",
              status: "ok",
              message: `responds correctly (protocol ${parsed.result.protocolVersion})`,
            });
          } else {
            checks.push({
              name: "MCP handshake",
              status: "warn",
              message: "unexpected response shape",
            });
          }
        } catch {
          checks.push({
            name: "MCP handshake",
            status: "fail",
            message: "first stdout line is not valid JSON",
          });
        }
      } else {
        checks.push({
          name: "MCP handshake",
          status: "fail",
          message: "no stdout received",
        });
      }
    } catch (err) {
      checks.push({
        name: "MCP handshake",
        status: "fail",
        message: err instanceof Error ? err.message : "spawn failed",
      });
    }
  }

  // ── Print results ──
  console.log("");
  console.log("sverklo doctor — checking MCP setup");
  console.log("");

  for (const c of checks) {
    const icon = c.status === "ok" ? "✓" : c.status === "warn" ? "!" : "✗";
    const color =
      c.status === "ok" ? "\x1b[32m" : c.status === "warn" ? "\x1b[33m" : "\x1b[31m";
    const reset = "\x1b[0m";
    console.log(`  ${color}${icon}${reset} ${c.name.padEnd(28)} ${c.message}`);
    if (c.fix) {
      console.log(`     ${"".padEnd(28)} → ${c.fix}`);
    }
  }

  const failed = checks.filter((c) => c.status === "fail").length;
  const warned = checks.filter((c) => c.status === "warn").length;
  console.log("");
  if (failed === 0 && warned === 0) {
    console.log("All checks passed. Restart Claude Code if sverklo isn't already loaded.");
  } else if (failed === 0) {
    console.log(`${warned} warning${warned === 1 ? "" : "s"} — sverklo should still work but may not be optimal.`);
  } else {
    console.log(`${failed} failure${failed === 1 ? "" : "s"}, ${warned} warning${warned === 1 ? "" : "s"}. Fix the failures above.`);
  }
  console.log("");
}

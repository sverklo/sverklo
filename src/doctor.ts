import { existsSync, readFileSync, statSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { track } from "./telemetry/index.js";

/**
 * Read the version from the package.json bundled with the running
 * binary. This reports what we actually are, not what happens to be
 * named `sverklo` on PATH. Issue #2.
 */
function readOwnVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    for (const rel of ["..", "../..", "../../.."]) {
      try {
        const pkg = JSON.parse(readFileSync(join(here, rel, "package.json"), "utf-8"));
        if (pkg.name === "sverklo" && pkg.version) return pkg.version;
      } catch {}
    }
  } catch {}
  return "unknown";
}

interface CheckResult {
  name: string;
  status: "ok" | "warn" | "fail";
  message: string;
  fix?: string;
}

export function runDoctor(projectPath: string): void {
  const checks: CheckResult[] = [];

  // Captured from .mcp.json so the MCP probe (step 7 below) spawns the
  // server with the same env Claude Code would. Without this, the doctor
  // probe inherits the user's shell env — which typically lacks
  // SVERKLO_PROFILE — and reports "36 tools advertised" even when
  // .mcp.json explicitly sets profile=core. That's the silent contradiction
  // UX caught in the 2026-05-10 audit: headline v0.20.9 fix invisible in
  // the headline v0.20.9 diagnostic.
  let mcpEnvFromConfig: Record<string, string> | undefined;

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
    // Before recommending a global install, check whether sverklo is
    // already present locally (in node_modules/.bin). Telling someone
    // who just ran `npm install sverklo` to also run `npm install -g`
    // overrides their explicit choice — and a project-local
    // `npx sverklo` is the right answer in that case.
    const localBin = join(projectPath, "node_modules", ".bin", "sverklo");
    const hasLocal = existsSync(localBin);
    if (hasLocal) {
      checks.push({
        name: "sverklo binary",
        status: "warn",
        message: `not on PATH, but found locally at ${localBin}`,
        fix: "use `npx sverklo …` from this directory, or add `./node_modules/.bin` to PATH",
      });
    } else {
      checks.push({
        name: "sverklo binary",
        status: "fail",
        message: "not found on PATH",
        fix: "npm install -g sverklo",
      });
    }
  }

  // 2. Version
  // Issue #2: report the version we actually are, not whatever
  // `sverklo --version` happens to return when run via PATH. The old
  // approach executed the binary on PATH as a subprocess, which
  // reports a different version whenever the running doctor was
  // launched from a non-PATH copy (`npm link`, node_modules/.bin,
  // direct dist path, etc.). The self-report is the truthful answer.
  const ownVersion = readOwnVersion();
  checks.push({
    name: "version",
    status: ownVersion === "unknown" ? "warn" : "ok",
    message: `sverklo v${ownVersion}`,
  });

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
        const entry = mcp.mcpServers.sverklo as {
          command?: string;
          args?: unknown[];
          env?: Record<string, string>;
        };
        const cmd = entry.command;
        const profile = entry.env?.SVERKLO_PROFILE;
        // Capture the env block so the MCP dispatch probe (check 7) can
        // forward it to spawnSync. See note at top of runDoctor.
        if (entry.env) mcpEnvFromConfig = entry.env;
        if (cmd === "sverklo" || cmd?.endsWith("/sverklo")) {
          // Surface the active profile in the OK message — silent 36-tool
          // configs are exactly the failure mode v0.20.9 fixed, so users
          // re-running doctor on stale configs need to see it.
          if (profile) {
            checks.push({
              name: ".mcp.json (project root)",
              status: "ok",
              message: `sverklo configured: ${cmd} (profile: ${profile})`,
            });
          } else {
            checks.push({
              name: ".mcp.json (project root)",
              status: "warn",
              message: `sverklo configured: ${cmd} — no SVERKLO_PROFILE set, Claude Code sees all 36 tools`,
              fix: "sverklo init (will add SVERKLO_PROFILE=core for 6-tool default)",
            });
          }
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

  // 5.4. AGENTS.md / CLAUDE.md prefer-sverklo block — issue #19.
  // Catch the drift cases: snippet in CLAUDE.md when CLAUDE.md
  // delegates to AGENTS.md (so the universal agent never sees it),
  // or both files exist but neither has the snippet.
  const agentsFilePath = join(projectPath, "AGENTS.md");
  const claudeFilePath = join(projectPath, "CLAUDE.md");
  const agentsExists = existsSync(agentsFilePath);
  const claudeExists = existsSync(claudeFilePath);
  if (agentsExists || claudeExists) {
    const agentsContent = agentsExists ? readFileSync(agentsFilePath, "utf-8") : "";
    const claudeContent = claudeExists ? readFileSync(claudeFilePath, "utf-8") : "";
    const agentsHasSnippet = agentsContent.includes("sverklo_search");
    const claudeHasSnippet = claudeContent.includes("sverklo_search");
    const claudeDelegatesToAgents = claudeExists && /agents\.md/i.test(claudeContent);

    if (agentsExists && claudeExists && claudeHasSnippet && !agentsHasSnippet && claudeDelegatesToAgents) {
      // Worst case: snippet went to CLAUDE.md but CLAUDE.md just
      // points at AGENTS.md, so non-Claude agents (Codex, OpenCode)
      // never see the prefer-sverklo block.
      checks.push({
        name: "prefer-sverklo instructions",
        status: "warn",
        message: "snippet is in CLAUDE.md, but CLAUDE.md delegates to AGENTS.md — non-Claude agents won't see it",
        fix: "move the ## Sverklo block from CLAUDE.md into AGENTS.md, or re-run `sverklo init` after deleting it from CLAUDE.md",
      });
    } else if (agentsHasSnippet || claudeHasSnippet) {
      const where = agentsHasSnippet && claudeHasSnippet
        ? "AGENTS.md and CLAUDE.md"
        : agentsHasSnippet
          ? "AGENTS.md"
          : "CLAUDE.md";
      checks.push({
        name: "prefer-sverklo instructions",
        status: "ok",
        message: `installed in ${where}`,
      });
    } else {
      checks.push({
        name: "prefer-sverklo instructions",
        status: "warn",
        message: `${agentsExists ? "AGENTS.md" : "CLAUDE.md"} exists but has no sverklo block`,
        fix: "sverklo init",
      });
    }
  }

  // 5.45. GitHub Copilot prefer-sverklo block — issue #24.
  //       Two failure modes: (a) file written but useInstructionFiles
  //       is off (silent no-op — Copilot ignores the file), (b) file
  //       missing entirely while VS Code/.github signals say the user
  //       likely uses Copilot. Both result in Copilot keeping its grep
  //       habits while sverklo gets the blame.
  const copilotPath = join(projectPath, ".github", "copilot-instructions.md");
  const copilotExists = existsSync(copilotPath);
  if (copilotExists) {
    const copilotContent = readFileSync(copilotPath, "utf-8");
    const hasSnippet = copilotContent.includes("sverklo_search");
    if (hasSnippet) {
      checks.push({
        name: "Copilot prefer-sverklo",
        status: "ok",
        message: "installed in .github/copilot-instructions.md",
      });
      // Read-only check on .vscode/settings.json — useInstructionFiles
      // controls whether Copilot actually reads the file. Default
      // varies across VS Code versions; if it's explicitly false,
      // the file is dead weight. Don't auto-fix — settings.json is
      // user territory.
      const vscodeSettingsPath = join(projectPath, ".vscode", "settings.json");
      if (existsSync(vscodeSettingsPath)) {
        try {
          const vsSettings = JSON.parse(readFileSync(vscodeSettingsPath, "utf-8")) as Record<
            string,
            unknown
          >;
          const KEY = "github.copilot.chat.codeGeneration.useInstructionFiles";
          if (vsSettings[KEY] === false) {
            checks.push({
              name: "Copilot useInstructionFiles",
              status: "warn",
              message: `${KEY} is false — Copilot will ignore .github/copilot-instructions.md`,
              fix: `set "${KEY}": true in .vscode/settings.json (or remove the key)`,
            });
          }
        } catch {
          // Invalid JSON — already surfaced elsewhere if needed.
        }
      }
    } else {
      checks.push({
        name: "Copilot prefer-sverklo",
        status: "warn",
        message: ".github/copilot-instructions.md exists but has no sverklo block",
        fix: "sverklo init",
      });
    }
  }

  // 5.5. Memory journal (JSONL mirror)
  // Issue #7: the JSONL memory mirror is silently advisory — if it's
  // broken, users never know. Surface it here so `sverklo doctor` is
  // the one place to find all failure modes.
  const journalPath = join(projectPath, ".sverklo", "memories.jsonl");
  if (existsSync(journalPath)) {
    try {
      const content = readFileSync(journalPath, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());
      let badLines = 0;
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (!entry.op || typeof entry.id !== "number" || !entry.ts) {
            badLines++;
          }
        } catch {
          badLines++;
        }
      }
      if (badLines === 0) {
        checks.push({
          name: "memory journal",
          status: "ok",
          message: `${lines.length} entries at .sverklo/memories.jsonl`,
        });
      } else {
        checks.push({
          name: "memory journal",
          status: "warn",
          message: `${badLines} malformed line(s) out of ${lines.length} in .sverklo/memories.jsonl — probably edited by hand`,
          fix: "Remove the bad lines or delete the file; sverklo will recreate it on the next memory write",
        });
      }
    } catch (err) {
      checks.push({
        name: "memory journal",
        status: "warn",
        message: `could not read .sverklo/memories.jsonl: ${(err as Error).message}`,
      });
    }
  } else {
    // Not having a journal yet is fine — it's only created on the
    // first memory write — so we don't warn. Report it as an info
    // line so the user knows where to look.
    checks.push({
      name: "memory journal",
      status: "ok",
      message: "not created yet (normal — appears on the first sverklo_remember call)",
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

  // 7. MCP round-trip: initialize → tools/list → tools/call sverklo_status.
  //    A passing handshake alone is not proof Claude Code can actually USE
  //    sverklo — it only proves the binary speaks JSON-RPC. The dispatch
  //    probe runs the same three calls Claude Code makes on every fresh
  //    session, so when this passes the user has positive evidence the
  //    full path works. Closes the silent-failure gap behind reports like
  //    "doctor said OK but Claude still doesn't call sverklo".
  if (sverkloBin) {
    const initReq = {
      jsonrpc: "2.0" as const,
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "sverklo-doctor", version: "1.0" },
      },
    };
    const initializedNote = {
      jsonrpc: "2.0" as const,
      method: "notifications/initialized",
    };
    const listReq = {
      jsonrpc: "2.0" as const,
      id: 2,
      method: "tools/list",
    };
    const callReq = {
      jsonrpc: "2.0" as const,
      id: 3,
      method: "tools/call",
      params: { name: "sverklo_status", arguments: {} },
    };
    const input =
      [initReq, initializedNote, listReq, callReq]
        .map((r) => JSON.stringify(r))
        .join("\n") + "\n";

    try {
      const result = spawnSync(sverkloBin, ["."], {
        input,
        encoding: "utf-8",
        cwd: projectPath,
        timeout: 15000,
        maxBuffer: 4 * 1024 * 1024,
        // Forward .mcp.json's env block (incl. SVERKLO_PROFILE) so the
        // probe sees the same tool surface Claude Code would. process.env
        // alone is wrong: users rarely have SVERKLO_PROFILE in their shell.
        env: { ...process.env, ...(mcpEnvFromConfig || {}) },
      });

      const out = result.stdout || "";
      const responses = new Map<number, unknown>();
      for (const line of out.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as { id?: number };
          if (typeof parsed.id === "number") responses.set(parsed.id, parsed);
        } catch {
          // Non-JSON output is ignored (logs may interleave with responses
          // depending on transport — only structured replies count.)
        }
      }

      // 7a. Handshake response (id=1)
      const initResp = responses.get(1) as
        | {
            result?: {
              protocolVersion?: string;
              serverInfo?: { name?: string };
            };
          }
        | undefined;
      if (initResp?.result?.serverInfo?.name === "sverklo") {
        checks.push({
          name: "MCP handshake",
          status: "ok",
          message: `responds correctly (protocol ${initResp.result.protocolVersion})`,
        });
      } else if (initResp) {
        checks.push({
          name: "MCP handshake",
          status: "warn",
          message: "unexpected response shape",
        });
      } else {
        checks.push({
          name: "MCP handshake",
          status: "fail",
          message: "no initialize response",
        });
      }

      // 7b. tools/list response (id=2) — proves the server advertises
      //     sverklo_status; if Claude Code can read this, it can route.
      const listResp = responses.get(2) as
        | { result?: { tools?: Array<{ name?: string }> }; error?: { message?: string } }
        | undefined;
      const advertised = listResp?.result?.tools?.map((t) => t.name).filter(Boolean) ?? [];
      if (advertised.length > 0) {
        const hasStatus = advertised.includes("sverklo_status");
        if (hasStatus) {
          checks.push({
            name: "MCP tools/list",
            status: "ok",
            message: `${advertised.length} tool${advertised.length === 1 ? "" : "s"} advertised (sverklo_status present)`,
          });
        } else {
          checks.push({
            name: "MCP tools/list",
            status: "warn",
            message: `${advertised.length} tools advertised but sverklo_status missing — profile may be filtering it`,
            fix: "unset SVERKLO_PROFILE or use SVERKLO_PROFILE=core",
          });
        }
      } else if (listResp?.error?.message) {
        checks.push({
          name: "MCP tools/list",
          status: "fail",
          message: `error: ${listResp.error.message}`,
        });
      } else {
        checks.push({
          name: "MCP tools/list",
          status: "fail",
          message: "no tools/list response — Claude Code would see zero tools",
        });
      }

      // 7c. tools/call sverklo_status (id=3) — proves dispatch end-to-end.
      const callResp = responses.get(3) as
        | {
            result?: { content?: Array<{ type?: string; text?: string }>; isError?: boolean };
            error?: { message?: string };
          }
        | undefined;
      const content = callResp?.result?.content;
      const firstText = content?.find((c) => c.type === "text")?.text ?? "";
      if (callResp?.result && !callResp.result.isError && firstText.length > 0) {
        checks.push({
          name: "MCP tools/call",
          status: "ok",
          message: `sverklo_status returned ${firstText.length} chars — dispatch round-trip works`,
        });
      } else if (callResp?.error?.message) {
        checks.push({
          name: "MCP tools/call",
          status: "fail",
          message: `error: ${callResp.error.message}`,
        });
      } else if (callResp?.result?.isError) {
        checks.push({
          name: "MCP tools/call",
          status: "fail",
          message: `tool returned isError: ${firstText.slice(0, 120)}`,
        });
      } else {
        checks.push({
          name: "MCP tools/call",
          status: "fail",
          message: "no tools/call response — Claude Code calls would hang or error",
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
    // The new tools/list + tools/call probes prove the same path Claude
    // Code uses end-to-end. Be explicit so users with prior "doctor passed
    // but it still doesn't work" experiences trust the new signal.
    console.log("All checks passed — MCP dispatch verified end-to-end.");
    console.log("If Claude Code was running before init, restart it to pick up the new config.");
  } else if (failed === 0) {
    console.log(`${warned} warning${warned === 1 ? "" : "s"} — sverklo should still work but may not be optimal.`);
  } else {
    console.log(`${failed} failure${failed === 1 ? "" : "s"}, ${warned} warning${warned === 1 ? "" : "s"}. Fix the failures above.`);
  }
  console.log("");

  // Telemetry: one event per run, plus one event per failure (no detail).
  // The doctor.issue count tells us setup pain rate without leaking what failed.
  void track("doctor.run");
  for (let i = 0; i < failed; i++) void track("doctor.issue");
}

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { track, hasBeenNudged, markNudged } from "./telemetry/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Shared prefer-sverklo instructions written to CLAUDE.md, AGENTS.md,
 * and .github/copilot-instructions.md. Single source of truth — divergence
 * across agents would silently desync guidance.
 */
export const SVERKLO_SNIPPET = `
## Sverklo — Code Intelligence

This project has the sverklo MCP server installed. Sverklo is a code-intelligence index: ranked search, dependency graph, persistent memory. Use it as the **default** tool for code discovery in this repo.

### Always Do

- **MUST call \`sverklo_overview\` before exploring an unfamiliar directory.** It returns the PageRank-ranked map of the codebase in one call — much cheaper than \`ls\` + \`Read\` loops.
- **MUST use \`sverklo_search\` instead of Grep for any query that is conceptual or fuzzy** ("how does auth work", "anything related to billing", "where do we handle retries"). Grep is for exact strings only.
- **MUST use \`sverklo_lookup\` to find a symbol's definition** by name — never grep + Read for this.
- **MUST run \`sverklo_impact\` before renaming, deleting, or changing the signature of any function/class/method** that may be called from elsewhere. Report the blast radius (callers, depth) to the user before editing.
- **MUST use \`sverklo_refs\` to enumerate callers of a symbol.**
- **MUST use \`sverklo_deps\` to see imports + importers of a file** before moving or splitting it.
- **MUST call \`sverklo_remember\` when the user corrects you** with phrasing like "stop X", "never X", "always Y", "don't Y", "prefer Z", "remember that I want Q", "actually, do W". Save with \`category:correction\` (stop/never/don't) or \`category:preference\` (prefer/want/like), \`kind:semantic\`, and the user's instruction as content. Save before continuing the response. Do not ask permission — corrections are explicit instructions to persist behavior across sessions.
- **MUST call \`sverklo_recall\` at the start of work** on a non-trivial task to surface prior decisions and corrections.

### Never Do

- **NEVER use Grep when the query is conceptual.** Grep cannot find "the auth flow" — sverklo_search can.
- **NEVER edit a function or class without first running \`sverklo_impact\`** on it. Silently breaking a caller is the most expensive bug this codebase produces.
- **NEVER ignore HIGH or CRITICAL impact warnings** without surfacing them to the user.
- **NEVER rename symbols with find-and-replace.** Use \`sverklo_refs\` first; it knows which "foo" is the function and which is a string.
- **NEVER save routine task summaries to memory.** \`sverklo_recall\` is only useful when hits are signal-dense — save only (a) bugs that took >1h to debug, (b) recurring mistakes, (c) non-obvious architectural decisions, (d) audit findings needing user judgment.
- **NEVER re-read a file sverklo just returned a path for.** Use \`sverklo_lookup\` for the specific symbol instead.

### When Grep / Read still wins

| Task | Tool |
|---|---|
| Exact string match (\`"TODO(alice)"\`, error message text) | Grep |
| Read a known file at a known path | Read |
| Inspect a specific line range | Read with offset/limit |

### Exploration order

\`sverklo_overview\` (1 call) → \`sverklo_search\` (1 call) → \`sverklo_lookup\` on the top hit → \`sverklo_refs\` / \`sverklo_impact\` only if you need the blast radius. If you've made 5 sverklo calls and still don't have the answer, **stop and ask a clarifying question** — don't burn 10 more.

### Output discipline

No preambles ("Here are the results", "Great question"), no closing affirmations, no em-dashes as conversational pauses. State the finding, show the fix, stop. User instructions override this file.
`;

function readFileMaybe(path: string): { exists: boolean; content: string; path: string } {
  if (!existsSync(path)) return { exists: false, content: "", path };
  return { exists: true, content: readFileSync(path, "utf-8"), path };
}

/**
 * Finding 6: case-insensitive lookup for instruction files in the
 * project root. Linux is case-sensitive, so a user with `Agents.md`
 * (Codex's lowercase convention) wouldn't match `existsSync("AGENTS.md")`.
 * On macOS/Windows the underlying FS is case-insensitive but we still
 * want to report the user's actual filename so messages match what
 * they see in their editor.
 */
export function findInstructionFile(
  projectPath: string,
  baseName: string
): { exists: boolean; content: string; path: string } {
  try {
    const target = baseName.toLowerCase();
    for (const entry of readdirSync(projectPath)) {
      if (entry.toLowerCase() === target) {
        const fullPath = join(projectPath, entry);
        return { exists: true, content: readFileSync(fullPath, "utf-8"), path: fullPath };
      }
    }
  } catch {
    // Unreadable directory — fall through to false
  }
  return { exists: false, content: "", path: join(projectPath, baseName) };
}

export interface AgentsFileInputs {
  projectPath: string;
  claudeMd: { exists: boolean; content: string; path: string };
  agentsMd: { exists: boolean; content: string; path: string };
  sentinel: string;
}

export type AgentsFileAction =
  | { action: "skip"; fileName: string; path: string }
  | { action: "append"; fileName: string; path: string; existingContent: string; note?: string }
  | { action: "create-claude-md"; fileName: "CLAUDE.md"; path: string };

/**
 * Secondary sentinel for Finding 7: detects the snippet's heading even
 * when the user hand-edited the body and removed the literal
 * "sverklo_search" sentinel. Without this, re-running `sverklo init`
 * would re-append the entire 30+ line snippet on top of the existing
 * (modified) one.
 */
const HEADING_SENTINEL_RE = /^##\s+Sverklo\b/m;

function snippetAlreadyPresent(content: string, sentinel: string): boolean {
  if (content.includes(sentinel)) return true;
  if (HEADING_SENTINEL_RE.test(content)) return true;
  return false;
}

/**
 * Decide which agent-instructions file to write the prefer-sverklo
 * snippet into. Issue #19 (RuslanZavacky): respect AGENTS.md when it
 * exists, especially when CLAUDE.md is a redirect-only file.
 *
 * Rules (in order):
 *   1. If either file already contains the snippet (literal sentinel
 *      OR `## Sverklo` heading), skip — idempotent.
 *   2. AGENTS.md is preferred IF it has real content, OR CLAUDE.md
 *      is missing/empty. An empty placeholder AGENTS.md (Finding 12)
 *      shouldn't beat a populated CLAUDE.md.
 *   3. Else if CLAUDE.md exists, append to it.
 *   4. Else create CLAUDE.md (don't auto-create AGENTS.md — too
 *      opinionated; we only modify files the user has opted into).
 */
export function resolveAgentsFileTarget(inputs: AgentsFileInputs): AgentsFileAction {
  const { claudeMd, agentsMd, sentinel } = inputs;

  // Finding 7: also check for the heading sentinel.
  if (agentsMd.exists && snippetAlreadyPresent(agentsMd.content, sentinel)) {
    return { action: "skip", fileName: "AGENTS.md", path: agentsMd.path };
  }
  if (claudeMd.exists && snippetAlreadyPresent(claudeMd.content, sentinel)) {
    return { action: "skip", fileName: "CLAUDE.md", path: claudeMd.path };
  }

  // Finding 12: an existing-but-empty file shouldn't beat a populated
  // one. Treat whitespace-only files as "not really invested in."
  const agentsHasContent = agentsMd.exists && agentsMd.content.trim() !== "";
  const claudeHasContent = claudeMd.exists && claudeMd.content.trim() !== "";

  // AGENTS.md wins if it has content, OR if CLAUDE.md isn't a real
  // option (missing or also empty). Both-empty case still goes to
  // AGENTS.md because that's the universal default.
  const preferAgents = agentsMd.exists && (agentsHasContent || !claudeHasContent);

  if (preferAgents) {
    let note: string | undefined;
    if (claudeHasContent && /agents\.md/i.test(claudeMd.content)) {
      note = "CLAUDE.md left alone — already delegates to AGENTS.md";
    } else if (claudeHasContent) {
      note = "CLAUDE.md left alone — AGENTS.md is the canonical location";
    }
    return {
      action: "append",
      fileName: "AGENTS.md",
      path: agentsMd.path,
      existingContent: agentsMd.content,
      note,
    };
  }
  if (claudeMd.exists) {
    return {
      action: "append",
      fileName: "CLAUDE.md",
      path: claudeMd.path,
      existingContent: claudeMd.content,
    };
  }
  return {
    action: "create-claude-md",
    fileName: "CLAUDE.md",
    path: claudeMd.path,
  };
}

export interface CopilotInstructionsInputs {
  projectPath: string;
  copilotFile: { exists: boolean; content: string; path: string };
  githubDirExists: boolean;
  vscodeDirExists: boolean;
  copilotExtensionDetected: boolean;
  sentinel: string;
}

export type CopilotInstructionsAction =
  | { action: "skip-no-signal" }
  | { action: "skip-already-present"; path: string }
  | { action: "append"; path: string; existingContent: string }
  | { action: "create"; path: string };

/**
 * Decide whether to write `.github/copilot-instructions.md` and how.
 *
 * Copilot reads this file as a preamble appended to every Chat prompt
 * (per github.com/copilot docs, custom-instructions). Without it, even
 * with sverklo's MCP server wired up, Copilot keeps grep-ing because
 * nothing tells it to prefer sverklo's tools.
 *
 * Signals (any one is enough — Copilot has no project-level marker file):
 *   - `.github/copilot-instructions.md` already exists (definite — append/skip)
 *   - `.github/` dir exists (project uses GitHub conventions)
 *   - `.vscode/` dir exists (VS Code is THE Copilot host)
 *   - `~/.vscode/extensions/github.copilot*` present (Copilot installed)
 *
 * If none of those, skip silently — don't create `.github/` or
 * `.vscode/` for projects that have nothing to do with either. Match
 * resolveAgentsFileTarget's "we only modify files the user has opted
 * into" philosophy.
 */
export function resolveCopilotInstructionsTarget(
  inputs: CopilotInstructionsInputs
): CopilotInstructionsAction {
  const { copilotFile, githubDirExists, vscodeDirExists, copilotExtensionDetected, sentinel } =
    inputs;

  if (copilotFile.exists && snippetAlreadyPresent(copilotFile.content, sentinel)) {
    return { action: "skip-already-present", path: copilotFile.path };
  }
  if (copilotFile.exists) {
    return { action: "append", path: copilotFile.path, existingContent: copilotFile.content };
  }

  const hasSignal = githubDirExists || vscodeDirExists || copilotExtensionDetected;
  if (!hasSignal) {
    return { action: "skip-no-signal" };
  }

  return { action: "create", path: copilotFile.path };
}

/**
 * Best-effort scan for the GitHub Copilot VS Code extension. Returns
 * true if any directory under ~/.vscode/extensions/ or
 * ~/.vscode-insiders/extensions/ matches `github.copilot*`. Silent on
 * failure (unreadable home, no extensions dir) — never throws.
 */
export function detectCopilotExtension(): boolean {
  const candidates = [
    join(homedir(), ".vscode", "extensions"),
    join(homedir(), ".vscode-insiders", "extensions"),
    join(homedir(), ".vscode-server", "extensions"),
  ];
  for (const dir of candidates) {
    try {
      if (!existsSync(dir)) continue;
      const entries = readdirSync(dir);
      if (entries.some((e) => /^github\.copilot/i.test(e))) return true;
    } catch {
      // unreadable — fall through
    }
  }
  return false;
}

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

/**
 * Install sverklo skill files into .claude/skills/ in the target project.
 * Idempotent: does not overwrite files the user may have customized.
 */
function installSkills(projectPath: string): void {
  // Skills source: src/skills/ relative to this file (works in both source and dist)
  // In dist: dist/src/init.js -> ../../src/skills/
  // In source (ts-node / tsx): src/init.ts -> ./skills/
  const candidateDirs = [
    join(__dirname, "skills"),                    // source layout: src/skills/
    join(__dirname, "..", "..", "src", "skills"),  // dist layout: dist/src/ -> ../../src/skills/
  ];

  const skillsSourceDir = candidateDirs.find(
    (d) => existsSync(d) && readdirSync(d).some((f) => f.endsWith(".md"))
  );

  if (!skillsSourceDir) {
    console.log("  .claude/skills/ — skill source files not found, skipping");
    return;
  }

  const skillsTargetDir = join(projectPath, ".claude", "skills");
  mkdirSync(skillsTargetDir, { recursive: true });

  const skillFiles = readdirSync(skillsSourceDir).filter((f) => f.endsWith(".md"));
  let installed = 0;
  let skipped = 0;

  for (const file of skillFiles) {
    const targetPath = join(skillsTargetDir, file);
    if (existsSync(targetPath)) {
      skipped++;
    } else {
      copyFileSync(join(skillsSourceDir, file), targetPath);
      installed++;
    }
  }

  if (installed > 0) {
    console.log(`  .claude/skills/ — installed ${installed} skill(s)${skipped > 0 ? ` (${skipped} already existed, skipped)` : ""}`);
  } else {
    console.log(`  .claude/skills/ — all ${skipped} skill(s) already installed`);
  }
}

/**
 * Build the PostToolUse hook that triggers incremental reindex after file writes.
 */
function buildReindexHook() {
  return {
    matcher: "Edit|Write",
    hooks: [
      {
        type: "command" as const,
        command: "sverklo wakeup . 2>/dev/null &",
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

  // 1. Add prefer-sverklo snippet to AGENTS.md / CLAUDE.md (issue #19).
  //    AGENTS.md is the universal convention (Codex, OpenCode, Cursor,
  //    Claude Code all read it); CLAUDE.md is Claude-Code-specific.
  //    Many projects keep CLAUDE.md as a one-line redirect to AGENTS.md
  //    so the universal instructions reach every agent.
  const agentsTarget = resolveAgentsFileTarget({
    projectPath,
    // Finding 6: case-insensitive lookup so Linux users with `Agents.md`
    // (Codex's lowercase) or any non-canonical case still hit the
    // existing file instead of creating a new one with our spelling.
    claudeMd: findInstructionFile(projectPath, "CLAUDE.md"),
    agentsMd: findInstructionFile(projectPath, "AGENTS.md"),
    sentinel: "sverklo_search",
  });
  let claudeMdCreatedByInit = false;
  switch (agentsTarget.action) {
    case "skip":
      console.log(`  ${agentsTarget.fileName} — already has sverklo instructions, skipping`);
      break;
    case "append":
      writeFileSync(agentsTarget.path, agentsTarget.existingContent + "\n" + SVERKLO_SNIPPET);
      console.log(`  ${agentsTarget.fileName} — appended sverklo instructions${agentsTarget.note ? ` (${agentsTarget.note})` : ""}`);
      break;
    case "create-claude-md":
      writeFileSync(agentsTarget.path, SVERKLO_SNIPPET.trim() + "\n");
      console.log("  CLAUDE.md — created with sverklo instructions");
      claudeMdCreatedByInit = true;
      break;
  }
  // Carry the legacy variable name forward for the rest of initProject —
  // ingestion logic in step 5 keys off "did init create CLAUDE.md".
  const claudeMdPath = join(projectPath, "CLAUDE.md");

  // 1.5. GitHub Copilot — issue #24. Copilot Chat reads
  //      `.github/copilot-instructions.md` as a preamble for every prompt.
  //      Without it, even with `.vscode/mcp.json` wired up, Copilot
  //      keeps grep-ing because nothing tells it to prefer sverklo.
  //      MCP integration is already covered by VS Code's `.vscode/mcp.json`
  //      below, so this block is purely about behavioral steering.
  const copilotInstructionsPath = join(projectPath, ".github", "copilot-instructions.md");
  const copilotExtensionDetected = detectCopilotExtension();
  const copilotTarget = resolveCopilotInstructionsTarget({
    projectPath,
    copilotFile: readFileMaybe(copilotInstructionsPath),
    githubDirExists: existsSync(join(projectPath, ".github")),
    vscodeDirExists: existsSync(join(projectPath, ".vscode")),
    copilotExtensionDetected,
    sentinel: "sverklo_search",
  });
  switch (copilotTarget.action) {
    case "skip-no-signal":
      // Silent — most projects don't use GitHub Copilot, no need for noise.
      break;
    case "skip-already-present":
      console.log("  .github/copilot-instructions.md — already has sverklo instructions, skipping");
      break;
    case "append":
      writeFileSync(copilotTarget.path, copilotTarget.existingContent + "\n" + SVERKLO_SNIPPET);
      console.log("  .github/copilot-instructions.md — appended sverklo instructions");
      break;
    case "create": {
      // Capture trigger reason BEFORE mkdirSync — otherwise `.github/`
      // would always show as the reason since mkdirSync creates it.
      const why = copilotExtensionDetected
        ? "Copilot extension detected"
        : existsSync(join(projectPath, ".github"))
          ? ".github/ exists"
          : ".vscode/ exists";
      mkdirSync(dirname(copilotTarget.path), { recursive: true });
      writeFileSync(copilotTarget.path, SVERKLO_SNIPPET.trim() + "\n");
      console.log(`  .github/copilot-instructions.md — created with sverklo instructions (${why})`);
      break;
    }
  }

  // 1.6. VS Code settings.json — flip on `useInstructionFiles` so
  //      Copilot actually reads `.github/copilot-instructions.md`.
  //      The default varies across VS Code versions, and a Copilot user
  //      with the file but the setting off gets a silent no-op (sverklo
  //      took the blame). Only touch this key — preserve everything else.
  if (
    copilotTarget.action === "create" ||
    copilotTarget.action === "append" ||
    copilotTarget.action === "skip-already-present"
  ) {
    const vscodeDir = join(projectPath, ".vscode");
    const vscodeSettingsPath = join(vscodeDir, "settings.json");
    if (existsSync(vscodeDir)) {
      type VsCodeSettings = Record<string, unknown>;
      let vsSettings: VsCodeSettings = {};
      let parsedOk = true;
      if (existsSync(vscodeSettingsPath)) {
        try {
          vsSettings = JSON.parse(readFileSync(vscodeSettingsPath, "utf-8")) as VsCodeSettings;
        } catch {
          // Don't clobber a broken-but-user-edited file.
          parsedOk = false;
        }
      }
      if (parsedOk) {
        const KEY = "github.copilot.chat.codeGeneration.useInstructionFiles";
        if (vsSettings[KEY] !== true) {
          vsSettings[KEY] = true;
          writeFileSync(vscodeSettingsPath, JSON.stringify(vsSettings, null, 2) + "\n");
          console.log(`  .vscode/settings.json — set ${KEY}: true`);
        }
      } else {
        console.log("  .vscode/settings.json — invalid JSON, skipping Copilot instructionFiles toggle");
      }
    }
  }

  // 1.7. .gitignore — make sure `.sverklo/` (per-project memory journal +
  //      local state) doesn't get committed. Issue #32 (nviraj) surfaced
  //      this for git-worktree users where the journal would otherwise
  //      bleed across worktrees on commit. Idempotent — only appends if
  //      neither the directory nor a parent pattern is already covered.
  const gitignorePath = join(projectPath, ".gitignore");
  const gitDirPath = join(projectPath, ".git");
  const SVERKLO_GITIGNORE_BLOCK =
    "# sverklo per-project state (memory journal, etc.)\n.sverklo/\n";
  if (existsSync(gitignorePath)) {
    const existing = readFileSync(gitignorePath, "utf-8");
    const SVERKLO_PATTERNS = [/^\.sverklo\/?$/m, /^\/\.sverklo\/?$/m];
    const alreadyCovered = SVERKLO_PATTERNS.some((re) => re.test(existing));
    if (!alreadyCovered) {
      const trailing = existing.endsWith("\n") ? "" : "\n";
      writeFileSync(
        gitignorePath,
        existing + trailing + "\n" + SVERKLO_GITIGNORE_BLOCK
      );
      console.log("  .gitignore — added .sverklo/ entry");
    } else {
      console.log("  .gitignore — already excludes .sverklo/, skipping");
    }
  } else if (existsSync(gitDirPath)) {
    // Fresh `git init` users have a .git/ directory but no .gitignore yet.
    // Without this branch the .sverklo/ journal silently gets staged on
    // their first `git add .` — exactly the bleed-across-worktrees failure
    // mode v0.20.14 was meant to prevent. Create a minimal .gitignore.
    writeFileSync(gitignorePath, SVERKLO_GITIGNORE_BLOCK);
    console.log("  .gitignore — created with .sverklo/ entry");
  }
  // No .git/ at all? Don't create a .gitignore — the project isn't a git
  // repo (or hasn't been initialized yet), so the file would be inert.

  // 2. MCP server config — Claude Code reads .mcp.json AT PROJECT ROOT for project-scoped servers.
  //    .claude/mcp.json is NOT read by Claude Code (verified Apr 2026).
  const mcpConfigPath = join(projectPath, ".mcp.json");
  const sverkloBin = resolveSverkloBinary();

  let mcpConfig: {
    mcpServers?: Record<
      string,
      { command: string; args: string[]; env?: Record<string, string> }
    >;
  } = {};
  if (existsSync(mcpConfigPath)) {
    try {
      mcpConfig = JSON.parse(readFileSync(mcpConfigPath, "utf-8"));
    } catch {
      mcpConfig = {};
    }
  }

  if (mcpConfig.mcpServers?.sverklo) {
    // Soft migration for users who ran `sverklo init` before v0.20.9 (when
    // we added the SVERKLO_PROFILE=core default). If the entry has no env
    // block at all, add it — silent 36→5 tool reduction on next CC restart.
    // If env exists (even empty), respect it: the user may have intentionally
    // chosen full or some other profile.
    const existing = mcpConfig.mcpServers.sverklo;
    if (!existing.env) {
      existing.env = { SVERKLO_PROFILE: "core" };
      writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2) + "\n");
      console.log(
        "  .mcp.json — added SVERKLO_PROFILE=core to existing sverklo entry (was loading 36 tools, now 5)"
      );
    } else {
      console.log("  .mcp.json — sverklo already configured, skipping");
    }
  } else {
    if (!mcpConfig.mcpServers) mcpConfig.mcpServers = {};
    // SVERKLO_PROFILE=core ships 6 tools (status/search/lookup/overview/refs/impact)
    // instead of the full 36. Claude Code stalls on tool selection when it
    // sees 36 sverklo tools alongside its built-ins; users with full(36)
    // report sverklo "doesn't get called" even after init succeeds. core
    // is the smallest set that still answers "find / understand / explore"
    // questions; users who need audit/diff/memory tools flip to lean/full via env.
    mcpConfig.mcpServers.sverklo = {
      command: sverkloBin,
      args: ["."],
      env: { SVERKLO_PROFILE: "core" },
    };
    writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2) + "\n");
    console.log(
      `  .mcp.json — added sverklo MCP server (${sverkloBin}, profile: core / 6 tools)`
    );
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

  // PostToolUse reindex hook: trigger incremental reindex after file writes
  {
    if (!settings.hooks) settings.hooks = {};
    if (!settings.hooks.PostToolUse) settings.hooks.PostToolUse = [];

    const existingPost = settings.hooks.PostToolUse as Array<{ hooks?: Array<{ command?: string }> }>;
    const alreadyHasReindex = existingPost.some((h) =>
      h.hooks?.some((hook) => hook.command?.includes("sverklo wakeup"))
    );

    if (!alreadyHasReindex) {
      existingPost.push(buildReindexHook() as unknown as { hooks?: Array<{ command?: string }> });
      settingsChanged = true;
    }
  }

  if (settingsChanged) {
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    const bits: string[] = [];
    if (!hasSverklo) bits.push("auto-allow for sverklo tools");
    if (options.autoCapture) bits.push("PostToolUse auto-capture hook");
    // Check if reindex hook was just added (not previously present)
    const postHooks = settings.hooks?.PostToolUse as Array<{ hooks?: Array<{ command?: string }> }> | undefined;
    const hasReindex = postHooks?.some((h) => h.hooks?.some((hook) => hook.command?.includes("sverklo wakeup")));
    if (hasReindex) bits.push("PostToolUse reindex hook");
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
    if (!agConfig.mcpServers) agConfig.mcpServers = {};
    const existing = agConfig.mcpServers.sverklo;
    const existingProject = existing?.args?.[0];
    if (existing && existingProject === projectPath) {
      console.log("  ~/.gemini/antigravity/mcp_config.json — sverklo already configured for this project");
    } else {
      // Antigravity's global config doesn't know about the per-project root, so
      // we pass the absolute project path explicitly. If a stale entry points at
      // a different project, rewrite it — that's what doctor's recommended fix
      // tells the user `init` will do.
      agConfig.mcpServers.sverklo = {
        command: sverkloBin,
        args: [projectPath],
      };
      writeFileSync(antigravityConfigPath, JSON.stringify(agConfig, null, 2) + "\n");
      if (existing) {
        console.log(
          `  ~/.gemini/antigravity/mcp_config.json — rewired sverklo from ${existingProject ?? "<unknown>"} → ${projectPath}`
        );
      } else {
        console.log(`  ~/.gemini/antigravity/mcp_config.json — added sverklo (project: ${projectPath})`);
      }
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
        // Don't ingest a CLAUDE.md we just created in this same run —
        // it's our boilerplate template, not user knowledge.
        skipPaths: claudeMdCreatedByInit ? ["CLAUDE.md"] : undefined,
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
  if (
    copilotExtensionDetected ||
    existsSync(join(projectPath, ".github", "copilot-instructions.md"))
  ) {
    void track("init.detected.copilot");
  }

  // 8. First-run nudge: ask once whether the user wants to opt in. Stored in
  //    ~/.sverklo/init-nudged so it never asks again, even across projects.
  //    Stays one line to avoid feeling pushy.
  if (!hasBeenNudged()) {
    console.log("");
    console.log(
      "Telemetry is OFF. We're trying to figure out which MCP clients people actually use"
    );
    console.log(
      "and which tools the agent reaches for first. If you're willing to share that, run:"
    );
    console.log("  sverklo telemetry enable");
    console.log(
      "Schema + opt-out is at github.com/sverklo/sverklo/blob/main/TELEMETRY.md"
    );
    markNudged();
  }

  console.log("");
  console.log("Restart Claude Code in this directory and sverklo will appear in /mcp.");
  // Next-steps footer: lead with the "wow moment" — sverklo's hand-
  // crafted hybrid-workflow prompts that combine sverklo tools with
  // grep/read fallbacks. They're the most differentiated artifact in
  // the product but were buried before; promoting them to the top of
  // post-init output gets the user a real audit in 30 seconds.
  console.log("");
  console.log("Try it now (30s codebase audit):");
  console.log("  sverklo audit-prompt | claude         # paste the prompt into Claude — or any AI agent");
  console.log("  sverklo audit                          # run a graded audit directly from the CLI");
  console.log("");
  console.log("Next steps:");
  console.log("  claude                                 # start coding — sverklo tools are preferred automatically");
  console.log("  sverklo receipt                        # see how many tokens your agent burned on grep last week");
  console.log("  sverklo ui                             # optional: open the web dashboard");
  console.log("  sverklo review --ref HEAD~1..HEAD      # diff-aware risk review (CI-friendly with --fail-on high)");
  console.log("");
  console.log("Tip: create a .sverklo.yaml to fine-tune indexing (weights, ignore patterns, search budgets).");
  console.log("  See https://sverklo.com/docs/config for the full schema.");
}

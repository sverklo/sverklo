import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { SVERKLO_SNIPPET } from "./init.js";
import { logSummary } from "./utils/logger.js";

// Issue #72 (HaleTom 2026-05-25): a global-instructions workflow user
// wants the "prefer sverklo" behavior baked in once per machine, plus
// per-project memory import — but NOT the per-project boilerplate
// (`.mcp.json`, project AGENTS.md, .claude/settings.local.json, skills,
// copilot/antigravity/codex configs, doctor) that `sverklo init` writes.
//
// `initGlobal()` is intentionally a different code path than `initProject()`.
// We deliberately do NOT refactor `initProject()` — its per-project writes
// are tested + dogfooded and we don't want to add a "skip everything"
// matrix of flags to a 530-line orchestrator. Shared bits (the SVERKLO_SNIPPET
// constant, the same heading-or-sentinel detection) come from `init.ts`.

// Global agent-instruction locations we write SVERKLO_SNIPPET to. These
// are the two real, documented user-level memory files:
//   - ~/.claude/CLAUDE.md — Claude Code reads this on every session
//     (per docs.claude.com/claude-code/memory)
//   - ~/.codex/AGENTS.md — Codex CLI reads this as user-level guidance
// Cursor, Windsurf, Antigravity etc. do not have a documented global
// agent-instructions file; their MCP wiring + per-project AGENTS.md is
// the only documented hook. So this list stays small on purpose — we
// only touch locations we know the agent will actually read.
export interface GlobalInstructionTarget {
  /** Display label used in CLI output (e.g. "~/.claude/CLAUDE.md"). */
  label: string;
  /** Absolute path the file lives at. */
  path: string;
}

const HEADING_SENTINEL_RE = /^##\s+Sverklo\b/m;
const LITERAL_SENTINEL = "sverklo_search";

function snippetAlreadyPresent(content: string): boolean {
  if (content.includes(LITERAL_SENTINEL)) return true;
  if (HEADING_SENTINEL_RE.test(content)) return true;
  return false;
}

/**
 * Build the canonical list of global agent-instruction targets relative
 * to a home directory. Exported so tests can override `homedir` cheaply.
 */
export function globalInstructionTargets(home: string = homedir()): GlobalInstructionTarget[] {
  return [
    { label: "~/.claude/CLAUDE.md", path: join(home, ".claude", "CLAUDE.md") },
    { label: "~/.codex/AGENTS.md", path: join(home, ".codex", "AGENTS.md") },
  ];
}

export type GlobalWriteAction =
  | { action: "skip"; label: string; path: string; reason: "already-present" }
  | { action: "append"; label: string; path: string }
  | { action: "create"; label: string; path: string };

/**
 * Decide-and-execute the SVERKLO_SNIPPET write at a single global target.
 * Idempotent: skip if the file already contains the snippet (literal
 * sentinel OR `## Sverklo` heading). Creates the parent directory only
 * when we're about to create the file — never opportunistically.
 */
export function writeGlobalInstructionsTo(target: GlobalInstructionTarget): GlobalWriteAction {
  if (existsSync(target.path)) {
    const existing = readFileSync(target.path, "utf-8");
    if (snippetAlreadyPresent(existing)) {
      return { action: "skip", label: target.label, path: target.path, reason: "already-present" };
    }
    const trailing = existing.endsWith("\n") ? "" : "\n";
    writeFileSync(target.path, existing + trailing + SVERKLO_SNIPPET);
    return { action: "append", label: target.label, path: target.path };
  }
  mkdirSync(dirname(target.path), { recursive: true });
  writeFileSync(target.path, SVERKLO_SNIPPET.trim() + "\n");
  return { action: "create", label: target.label, path: target.path };
}

/**
 * Per-project: add `.sverklo/` to the target project's `.gitignore`.
 * Mirrors the logic in `initProject()` (Section 1.7) but extracted so
 * `initGlobal()` can call it without dragging the rest of the kitchen-sink
 * init alongside. Returns an action label for CLI output.
 *
 * Behavior matches `initProject` exactly:
 *   - existing .gitignore + entry already covered  -> "already"
 *   - existing .gitignore + missing entry          -> "added"
 *   - no .gitignore but .git/ exists               -> "created"
 *   - no .git/ at all                              -> "no-git" (no-op)
 */
export type GitignoreAction = "already" | "added" | "created" | "no-git";

const SVERKLO_GITIGNORE_BLOCK =
  "# sverklo per-project state (memory journal, etc.)\n.sverklo/\n";
const SVERKLO_GITIGNORE_PATTERNS = [/^\.sverklo\/?$/m, /^\/\.sverklo\/?$/m];

export function addSverkloToGitignore(projectPath: string): GitignoreAction {
  const gitignorePath = join(projectPath, ".gitignore");
  const gitDirPath = join(projectPath, ".git");
  if (existsSync(gitignorePath)) {
    const existing = readFileSync(gitignorePath, "utf-8");
    const alreadyCovered = SVERKLO_GITIGNORE_PATTERNS.some((re) => re.test(existing));
    if (alreadyCovered) return "already";
    const trailing = existing.endsWith("\n") ? "" : "\n";
    writeFileSync(gitignorePath, existing + trailing + "\n" + SVERKLO_GITIGNORE_BLOCK);
    return "added";
  }
  if (existsSync(gitDirPath)) {
    writeFileSync(gitignorePath, SVERKLO_GITIGNORE_BLOCK);
    return "created";
  }
  return "no-git";
}

export interface InitGlobalOptions {
  /** Optional override for `homedir()`. Tests use this; CLI does not. */
  home?: string;
  /** Forward to `importExistingMemories` — mirrors `initProject`'s flag. */
  mineChats?: boolean;
}

export interface InitGlobalResult {
  globalWrites: GlobalWriteAction[];
  registered: { name: string; path: string };
  gitignore: GitignoreAction;
  memoryImport: { imported: number; skipped: number; sources: string[] } | { skipped: "no-model" } | { skipped: "error"; error: string };
}

/**
 * Issue #72 — one-time-per-machine setup + lightweight per-project bits.
 *
 * Steps (all idempotent):
 *   1. Write SVERKLO_SNIPPET to global agent-instruction locations
 *      (one-time per machine; subsequent calls skip these).
 *   2. registerRepo(deriveRepoName(targetPath), targetPath)
 *   3. Add `.sverklo/` to target project's `.gitignore`
 *   4. importExistingMemories(targetPath)
 *
 * Explicitly NOT done (vs `initProject`):
 *   - No project `.mcp.json`
 *   - No project AGENTS.md / CLAUDE.md / .cursorrules writes
 *   - No `.claude/settings.local.json`
 *   - No skill install
 *   - No `~/.codex/config.toml`, `~/.copilot/mcp-config.json`,
 *     `~/.gemini/antigravity/mcp_config.json` writes
 *   - No doctor run
 */
export async function initGlobal(
  targetPath: string,
  options: InitGlobalOptions = {}
): Promise<InitGlobalResult> {
  const home = options.home ?? homedir();
  logSummary(`Initializing Sverklo (global mode) for ${targetPath}`);
  logSummary("");

  // 1. Global agent-instruction snippet — one-time per machine.
  logSummary("Global agent instructions:");
  const targets = globalInstructionTargets(home);
  const globalWrites: GlobalWriteAction[] = [];
  for (const t of targets) {
    const result = writeGlobalInstructionsTo(t);
    globalWrites.push(result);
    switch (result.action) {
      case "skip":
        logSummary(`  ${result.label} — already has sverklo instructions, skipping`);
        break;
      case "append":
        logSummary(`  ${result.label} — appended sverklo instructions`);
        break;
      case "create":
        logSummary(`  ${result.label} — created with sverklo instructions`);
        break;
    }
  }

  // 2. Register the project in the global registry.
  const { registerRepo, deriveRepoName } = await import("./registry/registry.js");
  const repoName = deriveRepoName(targetPath);
  registerRepo(repoName, targetPath);
  logSummary("");
  logSummary(`Registered "${repoName}" → ${targetPath}`);

  // 3. .gitignore: add .sverklo/ so per-project state doesn't get committed.
  const gitignore = addSverkloToGitignore(targetPath);
  switch (gitignore) {
    case "already":
      logSummary("  .gitignore — already excludes .sverklo/, skipping");
      break;
    case "added":
      logSummary("  .gitignore — added .sverklo/ entry");
      break;
    case "created":
      logSummary("  .gitignore — created with .sverklo/ entry");
      break;
    case "no-git":
      // No-op: not a git repo. Match `initProject` — don't create a
      // .gitignore in non-git directories (it would be inert).
      break;
  }

  // 4. Memory import — same gating as `initProject`: only if the ONNX
  //    model is on disk. If not, memories will be imported on first run.
  logSummary("");
  logSummary("Scanning for existing project knowledge...");
  let memoryImport: InitGlobalResult["memoryImport"] = { skipped: "error", error: "not-attempted" };
  try {
    const modelPath = join(home, ".sverklo", "models", "model.onnx");
    if (!existsSync(modelPath)) {
      logSummary("  model not yet downloaded — memories will be imported on first run");
      memoryImport = { skipped: "no-model" };
    } else {
      const { getProjectConfig } = await import("./utils/config.js");
      const { Indexer } = await import("./indexer/indexer.js");
      const { importExistingMemories } = await import("./memory/import.js");

      const config = getProjectConfig(targetPath);
      const indexer = new Indexer(config);
      const result = await importExistingMemories(indexer, targetPath, {
        mineChats: options.mineChats ?? false,
      });
      indexer.close();

      if (result.imported > 0) {
        logSummary(`  imported ${result.imported} memories from:`);
        for (const src of result.sources) {
          logSummary(`    · ${src}`);
        }
        if (result.skipped > 0) {
          logSummary(`  (${result.skipped} duplicates skipped)`);
        }
      } else {
        const hint = options.mineChats
          ? "  no CLAUDE.md, .cursorrules, ADRs, or matching Claude Code chats found — skipping"
          : "  no CLAUDE.md, .cursorrules, or ADRs found — skipping";
        logSummary(hint);
      }
      memoryImport = result;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logSummary("  (memory import skipped)");
    memoryImport = { skipped: "error", error: msg };
  }

  logSummary("");
  logSummary("Global setup complete. Next steps:");
  logSummary("  - Your agent will now prefer sverklo tools by default (from global instructions).");
  logSummary("  - To wire sverklo's MCP server into a project, run `sverklo init` there.");
  logSummary("  - To re-import memories from another project later, run `sverklo memory import [path]`.");

  return {
    globalWrites,
    registered: { name: repoName, path: targetPath },
    gitignore,
    memoryImport,
  };
}

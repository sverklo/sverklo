import { execSync, spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve as resolvePath, sep } from "node:path";
import type { Indexer } from "../../indexer/indexer.js";

export const astGrepTool = {
  name: "sverklo_ast_grep",
  description:
    "Find code by AST shape, not text — e.g. 'every console.log($X)', " +
    "'every catch (e) { return null }'. Requires ast-grep on PATH. Pick this " +
    "over sverklo_search when you need exact structural matches (consistent " +
    "transformations, lint-style queries) and over Grep when you need to " +
    "ignore identifier names or whitespace. Falls back to a clear error if " +
    "ast-grep is missing.",
  inputSchema: {
    type: "object" as const,
    properties: {
      pattern: { type: "string", description: "e.g. 'console.log($A)'" },
      language: { type: "string", description: "typescript, python, rust, go, …" },
      path: { type: "string", description: "Default: project root" },
    },
    required: ["pattern"],
  },
};

const NOT_INSTALLED_MESSAGE =
  "ast-grep not installed. Install with: brew install ast-grep / npm install -g @ast-grep/cli";

export function handleAstGrep(
  indexer: Indexer,
  args: Record<string, unknown>
): string {
  const pattern = args.pattern as string;
  const language = args.language as string | undefined;
  const rawPath = (args.path as string | undefined) || indexer.rootPath;

  if (!pattern) {
    return "Error: pattern is required";
  }

  // Containment check: resolve symlinks, verify the requested path is
  // inside the indexed project root. Without this an agent (or a hostile
  // prompt) can search /etc, ~/.aws, or sibling repos through this tool.
  let path: string;
  try {
    const absRoot = realpathSync(resolvePath(indexer.rootPath));
    const absTarget = realpathSync(resolvePath(rawPath));
    const rootWithSep = absRoot.endsWith(sep) ? absRoot : absRoot + sep;
    if (absTarget !== absRoot && !absTarget.startsWith(rootWithSep)) {
      return `Error: \`path\` must be inside the indexed project (${absRoot}). Got: ${absTarget}`;
    }
    path = absTarget;
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === "ENOENT") {
      return `Error: path not found: ${rawPath}`;
    }
    return `Error: failed to resolve path: ${e.message ?? String(err)}`;
  }

  // Check ast-grep availability first
  try {
    execSync("ast-grep --version", { stdio: "ignore", timeout: 3000 });
  } catch {
    return NOT_INSTALLED_MESSAGE;
  }

  const args_list = ["--pattern", pattern];
  if (language) {
    args_list.push("--lang", language);
  }
  args_list.push(path);

  let output: string;
  try {
    const result = spawnSync("ast-grep", args_list, {
      encoding: "utf-8",
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
    });
    if (result.error) {
      if (/ENOENT/i.test(result.error.message)) {
        return NOT_INSTALLED_MESSAGE;
      }
      throw result.error;
    }
    // ast-grep returns non-zero when no matches; treat stdout as authoritative
    if (result.status !== 0 && !result.stdout) {
      const stderr = (result.stderr || "").trim();
      if (/not found|ENOENT/i.test(stderr)) {
        return NOT_INSTALLED_MESSAGE;
      }
      return `ast-grep error: ${stderr || "unknown error"}`;
    }
    output = result.stdout;
  } catch (err) {
    const e = err as { message?: string };
    return `ast-grep error: ${e.message || "unknown error"}`;
  }

  const trimmed = output.trim();
  if (!trimmed) {
    return `No matches for pattern: ${pattern}`;
  }

  // ast-grep default output is already in file:line format with context.
  // Cap to a reasonable size to avoid blowing the context window.
  const lines = trimmed.split("\n");
  const MAX_LINES = 200;
  if (lines.length > MAX_LINES) {
    return (
      lines.slice(0, MAX_LINES).join("\n") +
      `\n\n... (${lines.length - MAX_LINES} more lines truncated)`
    );
  }
  return trimmed;
}

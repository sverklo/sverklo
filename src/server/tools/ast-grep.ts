import { execSync } from "node:child_process";
import type { Indexer } from "../../indexer/indexer.js";

export const astGrepTool = {
  name: "sverklo_ast_grep",
  description:
    "Structural AST search via ast-grep (if installed). For shape-matching that regex can't express.",
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
  const path = (args.path as string | undefined) || indexer.rootPath;

  if (!pattern) {
    return "Error: pattern is required";
  }

  // Check ast-grep availability first
  try {
    execSync("ast-grep --version", { stdio: "ignore", timeout: 3000 });
  } catch {
    return NOT_INSTALLED_MESSAGE;
  }

  const cmdParts = ["ast-grep", "--pattern", JSON.stringify(pattern)];
  if (language) {
    cmdParts.push("--lang", language);
  }
  cmdParts.push(JSON.stringify(path));

  let output: string;
  try {
    output = execSync(cmdParts.join(" "), {
      encoding: "utf-8",
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string; message?: string };
    // ast-grep returns non-zero when no matches; treat stdout as authoritative
    if (e.stdout) {
      output = e.stdout;
    } else {
      const stderr = (e.stderr || e.message || "").toString().trim();
      if (/not found|ENOENT/i.test(stderr)) {
        return NOT_INSTALLED_MESSAGE;
      }
      return `ast-grep error: ${stderr || "unknown error"}`;
    }
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

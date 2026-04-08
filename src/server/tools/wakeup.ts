import type { Indexer } from "../../indexer/indexer.js";

export const wakeupTool = {
  name: "sverklo_wakeup",
  description:
    "Compressed project context for non-MCP clients (system-prompt injection).",
  inputSchema: {
    type: "object" as const,
    properties: {
      format: {
        type: "string",
        enum: ["markdown", "plain"],
        description: "Output format (default: markdown)",
      },
      max_tokens: {
        type: "number",
        description: "Approximate max tokens (default: 500 — intentionally small for system-prompt use)",
      },
    },
  },
};

export function handleWakeup(indexer: Indexer, args: Record<string, unknown>): string {
  return generateWakeup(indexer, {
    maxTokens: (args.max_tokens as number) || 500,
    format: (args.format as "markdown" | "plain") || "markdown",
  });
}

export function generateWakeup(
  indexer: Indexer,
  options: { maxTokens?: number; format?: "markdown" | "plain" } = {}
): string {
  const maxTokens = options.maxTokens || 500;
  const status = indexer.getStatus();
  const coreMemories = indexer.memoryStore.getCore(10);
  const topFiles = indexer.fileStore.getAll().slice(0, 5);

  const parts: string[] = [];

  parts.push(`# ${status.projectName}`);
  parts.push(`${status.fileCount} files · ${status.languages.join(", ") || "unknown"}`);
  parts.push("");

  if (topFiles.length > 0) {
    parts.push(`## Core files (by dependency rank)`);
    for (const f of topFiles) {
      if (f.pagerank > 0) {
        parts.push(`- \`${f.path}\``);
      }
    }
    parts.push("");
  }

  if (coreMemories.length > 0) {
    parts.push(`## Project invariants`);
    for (const m of coreMemories) {
      parts.push(`- [${m.category}] ${m.content}`);
    }
    parts.push("");
  } else {
    const recent = indexer.memoryStore.getAll(5);
    if (recent.length > 0) {
      parts.push(`## Recent context`);
      for (const m of recent) {
        parts.push(`- ${m.content}`);
      }
      parts.push("");
    }
  }

  parts.push(`_Sverklo-generated wake-up. For full search, use sverklo_search via MCP._`);

  let output = parts.join("\n");

  // Enforce token budget
  const maxChars = maxTokens * 3.5;
  if (output.length > maxChars) {
    output = output.slice(0, maxChars) + "\n...[truncated]";
  }

  return output;
}

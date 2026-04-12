import type { Indexer } from "../../indexer/indexer.js";
import type { FileRecord } from "../../types/index.js";
import { resolveBudget } from "../../utils/budget.js";

export const findReferencesTool = {
  name: "sverklo_refs",
  description:
    "Find all references to a symbol across the codebase. Shows where a function, class, or type is imported, called, or used. Matches on identifier word boundaries by default — `embed` does NOT match `embeddingStore`. Pass `exact: false` to opt into substring matching.",
  inputSchema: {
    type: "object" as const,
    properties: {
      symbol: {
        type: "string",
        description: "Symbol name to find references for",
      },
      exact: {
        type: "boolean",
        description:
          "When true (default), match on whole-identifier boundaries — `embed` won't match `embeddingStore`. When false, substring-match like the old behavior.",
      },
      token_budget: {
        type: "number",
        description: "Max tokens to return (default: 2000)",
      },
    },
    required: ["symbol"],
  },
};

/**
 * Build a matcher function that decides whether a line references
 * the symbol. Issue #14: short symbol names like `embed` were matching
 * `embeddingStore` and dozens of other unrelated identifiers via
 * substring, polluting the output. Word-boundary matching is the
 * right default — users can opt out via `exact: false` for the rare
 * case where they genuinely want substring.
 *
 * We escape the symbol before using it in a regex so that users can
 * look up symbols that contain regex metacharacters (e.g. `$scope`,
 * `Foo.bar`) without the query being reinterpreted.
 */
function buildSymbolMatcher(symbol: string, exact: boolean): (line: string) => boolean {
  if (!exact) {
    return (line: string) => line.includes(symbol);
  }
  // \b uses \w = [A-Za-z0-9_], which is what we want for
  // JS/TS/Python/Go/Rust/Java/C/C++/Ruby/PHP identifiers. It's not
  // perfect for Unicode identifiers (Kotlin, Swift can use non-ASCII)
  // but for the supported languages it gives the right answer in
  // every case we tested in the dogfood session.
  const escaped = symbol.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const re = new RegExp(`\\b${escaped}\\b`);
  return (line: string) => re.test(line);
}

export function handleFindReferences(
  indexer: Indexer,
  args: Record<string, unknown>
): string {
  const symbol = args.symbol;
  if (typeof symbol !== "string" || symbol.trim() === "") {
    return 'Error: `symbol` is required. Usage: sverklo_refs symbol:"MyClass".';
  }
  const exact = args.exact !== false; // default true
  const tokenBudget = resolveBudget(args, "refs", null, 2000);
  const matches = buildSymbolMatcher(symbol, exact);

  // Use FTS to find candidate chunks mentioning the symbol at all.
  // FTS still does substring-ish matching on the chunk body, but we
  // re-filter every candidate line against the matcher above before
  // we keep it — so the output respects the exact/word-boundary
  // contract even when FTS hands us noise.
  const ftsResults = indexer.chunkStore.searchFts(symbol, 50);

  const fileCache = new Map<number, FileRecord>();
  for (const f of indexer.fileStore.getAll()) {
    fileCache.set(f.id, f);
  }

  // Group by file
  const byFile = new Map<string, { line: number; context: string; type: string }[]>();

  for (const chunk of ftsResults) {
    const file = fileCache.get(chunk.file_id);
    if (!file) continue;

    // Early reject: if the symbol doesn't appear in the chunk at all
    // (under the current matching mode), skip the per-line scan.
    if (!matches(chunk.content)) continue;

    // Find specific lines that actually contain the symbol as a
    // whole word (or substring, if exact=false).
    const lines = chunk.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (matches(lines[i])) {
        const refs = byFile.get(file.path) || [];
        refs.push({
          line: chunk.start_line + i,
          context: lines[i].trim(),
          type: chunk.type,
        });
        byFile.set(file.path, refs);
      }
    }
  }

  // Format output
  const parts: string[] = [];
  let remaining = tokenBudget;

  // Sort files by PageRank
  const sortedFiles = [...byFile.entries()].sort((a, b) => {
    const fileA = [...fileCache.values()].find((f) => f.path === a[0]);
    const fileB = [...fileCache.values()].find((f) => f.path === b[0]);
    return (fileB?.pagerank || 0) - (fileA?.pagerank || 0);
  });

  parts.push(`## References to '${symbol}' (${sortedFiles.reduce((s, [, refs]) => s + refs.length, 0)} total)\n`);

  for (const [filePath, refs] of sortedFiles) {
    const header = `### ${filePath}`;
    const headerCost = Math.ceil(header.length / 3.5);
    if (remaining < headerCost + 20) break;

    parts.push(header);
    remaining -= headerCost;

    for (const ref of refs) {
      const line = `  L${ref.line}: ${ref.context}`;
      const lineCost = Math.ceil(line.length / 3.5);
      if (remaining < lineCost) break;
      parts.push(line);
      remaining -= lineCost;
    }
    parts.push("");
  }

  return parts.length > 1 ? parts.join("\n") : `No references found for '${symbol}'.`;
}

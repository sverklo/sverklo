import type { FileRecord, CodeChunk } from "../types/index.js";

export interface OverviewEntry {
  file: FileRecord;
  chunks: CodeChunk[];
}

export function formatOverview(
  entries: OverviewEntry[],
  tokenBudget: number,
  basePath?: string
): string {
  const parts: string[] = [];
  let remaining = tokenBudget;

  // Group by directory
  const dirs = new Map<string, OverviewEntry[]>();
  for (const entry of entries) {
    const dir = entry.file.path.split("/").slice(0, -1).join("/") || ".";
    if (!basePath || dir.startsWith(basePath)) {
      const existing = dirs.get(dir) || [];
      existing.push(entry);
      dirs.set(dir, existing);
    }
  }

  // Sort directories, most important files first within each
  const sortedDirs = [...dirs.entries()].sort((a, b) => {
    const maxA = Math.max(...a[1].map((e) => e.file.pagerank));
    const maxB = Math.max(...b[1].map((e) => e.file.pagerank));
    return maxB - maxA;
  });

  for (const [dir, dirEntries] of sortedDirs) {
    const dirLine = `${dir}/`;
    const dirCost = 5; // tokens for dir header
    if (remaining < dirCost + 20) break;

    parts.push(dirLine);
    remaining -= dirCost;

    // Sort files by PageRank within directory
    dirEntries.sort((a, b) => b.file.pagerank - a.file.pagerank);

    for (const entry of dirEntries) {
      const fileName = entry.file.path.split("/").pop() || entry.file.path;
      const symbols = entry.chunks
        .filter((c) => c.name)
        .map((c) => `${c.name}()`)
        .slice(0, 8)
        .join(", ");

      const line = `  ${fileName} [${entry.file.pagerank.toFixed(2)}] — ${symbols || "(no named exports)"}`;
      const lineCost = Math.ceil(line.length / 3.5);

      if (remaining < lineCost) break;
      parts.push(line);
      remaining -= lineCost;
    }
  }

  return parts.join("\n");
}

export function formatLookup(
  chunks: (CodeChunk & { filePath?: string; pagerank?: number; fileLanguage?: string })[],
  files: Map<number, FileRecord>,
  tokenBudget: number
): string {
  if (chunks.length === 0) return "No results found.";

  const parts: string[] = [];
  let remaining = tokenBudget;
  let fittedAny = false;

  // Bug B (issue #15 investigation): chunks that didn't fit the
  // budget used to be silently dropped if ANY other chunk fit. On
  // a query for 'Indexer', that meant the real 470-line Indexer
  // class (4730 tokens) was replaced by a 150-token
  // fakeIndexerWithCore test helper with no hint that the real
  // match was hiding right behind it. Track skipped chunks so we
  // can always surface them, even when other matches fit.
  const skipped: typeof chunks = [];

  for (const chunk of chunks) {
    const file = files.get(chunk.file_id);
    const filePath = chunk.filePath || file?.path || "unknown";
    const lang = chunk.fileLanguage || file?.language || "";

    const header = `## ${filePath}:${chunk.start_line}-${chunk.end_line} (${chunk.type}: ${chunk.name})`;
    const headerCost = Math.ceil(header.length / 3.5);
    const contentCost = chunk.token_count;
    const totalCost = headerCost + contentCost + 10;

    if (remaining < totalCost) {
      skipped.push(chunk);
      continue;
    }

    parts.push(header);
    parts.push(`\`\`\`${lang}`);
    parts.push(chunk.content);
    parts.push("```\n");
    remaining -= totalCost;
    fittedAny = true;
  }

  // Two cases that both produce a "location-only" section:
  //
  //   1. Nothing fit → the old "All N matches exceed budget" fallback.
  //      We still need this because returning "No results found" for
  //      matches that exist but are oversized is actively misleading.
  //
  //   2. Some fit, some didn't → list the ones that didn't so the
  //      caller knows they exist. This is the bug-B fix.
  if (!fittedAny) {
    parts.push(
      `_All ${chunks.length} match${chunks.length === 1 ? "" : "es"} exceed token_budget=${tokenBudget}. Showing locations only — re-run with a larger token_budget or use Read for the full body._`
    );
    parts.push("");
    for (const chunk of chunks.slice(0, 10)) {
      const file = files.get(chunk.file_id);
      const filePath = chunk.filePath || file?.path || "unknown";
      const sig = chunk.signature ? `  \`${chunk.signature.trim()}\`` : "";
      parts.push(
        `- **${filePath}:${chunk.start_line}-${chunk.end_line}** (${chunk.type}: ${chunk.name}, ~${chunk.token_count} tokens)${sig}`
      );
    }
  } else if (skipped.length > 0) {
    parts.push("");
    parts.push(
      `_${skipped.length} additional match${skipped.length === 1 ? "" : "es"} too large to fit token_budget=${tokenBudget}:_`
    );
    for (const chunk of skipped.slice(0, 10)) {
      const file = files.get(chunk.file_id);
      const filePath = chunk.filePath || file?.path || "unknown";
      const sig = chunk.signature ? `  \`${chunk.signature.trim()}\`` : "";
      parts.push(
        `- **${filePath}:${chunk.start_line}-${chunk.end_line}** (${chunk.type}: ${chunk.name}, ~${chunk.token_count} tokens)${sig}`
      );
    }
    if (skipped.length > 10) {
      parts.push(`- _...and ${skipped.length - 10} more_`);
    }
    parts.push(
      `_Raise token_budget or call sverklo_lookup with the specific symbol to see the body._`
    );
  }

  return parts.join("\n");
}

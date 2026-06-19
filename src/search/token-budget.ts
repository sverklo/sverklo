import type { FileRecord, CodeChunk } from "../types/index.js";
import { formatEnoughness, type EnoughnessConfidence } from "./enoughness.js";

export interface OverviewEntry {
  file: FileRecord;
  chunks: CodeChunk[];
}

export function formatOverview(
  entries: OverviewEntry[],
  tokenBudget: number,
  basePath?: string,
  depth: 1 | 2 | 3 | 4 = 3
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

  // Depth 1 — only the directory list. Cheapest possible orientation.
  if (depth === 1) {
    for (const [dir] of sortedDirs) {
      const line = `${dir}/`;
      const cost = Math.ceil(line.length / 3.5);
      if (remaining < cost) break;
      parts.push(line);
      remaining -= cost;
    }
    return parts.join("\n");
  }

  // depth >= 2: walk directories, listing files and (at depth >= 3) symbols.
  const symbolCap = depth >= 4 ? 999 : 8;
  // If every file ends up clamped to PageRank 1.00 (the normalization
  // ceiling), the display strips all signal — `audit.ts [1.00]` looks
  // identical to `_validation.ts [1.00]`. Pre-compute whether the
  // entries span any meaningful range; if not, show relative rank
  // (`1/44`) instead of the floored PageRank. Dogfood review
  // 2026-05-14 (Issue I — overview PageRank floor).
  let pagerankRange = 0;
  let totalEntries = 0;
  for (const [, dirEntries] of sortedDirs) {
    for (const e of dirEntries) {
      totalEntries++;
      pagerankRange = Math.max(pagerankRange, e.file.pagerank);
    }
  }
  const minPagerank = (() => {
    let m = Infinity;
    for (const [, dirEntries] of sortedDirs) {
      for (const e of dirEntries) m = Math.min(m, e.file.pagerank);
    }
    return m === Infinity ? 0 : m;
  })();
  // Range is meaningfully small if max-min < 0.05 — everything is
  // bunched at the normalization ceiling.
  const useRelativeRank = pagerankRange - minPagerank < 0.05 && totalEntries > 5;
  let relativeIdx = 0;
  const formatScore = (pr: number): string => {
    if (useRelativeRank) {
      relativeIdx++;
      return `#${relativeIdx}/${totalEntries}`;
    }
    return pr.toFixed(2);
  };
  for (const [dir, dirEntries] of sortedDirs) {
    const dirLine = `${dir}/`;
    const dirCost = 5;
    if (remaining < dirCost + 20) break;

    parts.push(dirLine);
    remaining -= dirCost;

    dirEntries.sort((a, b) => b.file.pagerank - a.file.pagerank);

    for (const entry of dirEntries) {
      const fileName = entry.file.path.split("/").pop() || entry.file.path;
      const score = formatScore(entry.file.pagerank);
      let line: string;
      if (depth === 2) {
        // Files only — no symbols, much cheaper.
        line = `  ${fileName} [${score}]`;
      } else {
        const symbols = entry.chunks
          .filter((c) => c.name)
          .map((c) => `${c.name}()`)
          .slice(0, symbolCap)
          .join(", ");
        line = `  ${fileName} [${score}] — ${symbols || "(no named exports)"}`;
      }
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
  tokenBudget: number,
  opts: { symbol?: string } = {}
): string {
  if (chunks.length === 0) return "No results found.";

  const parts: string[] = [];
  let remaining = tokenBudget;
  let fittedAny = false;
  let renderedCount = 0;
  let locationOnlyCount = 0;

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
    // P1-12: surface enriched purpose when available.
    const purposeRaw = chunk.purpose ?? null;
    if (purposeRaw) {
      const m = /^\[[a-f0-9]{16}\] (.*)$/.exec(purposeRaw);
      const purpose = m ? m[1] : purposeRaw;
      parts.push(`_${purpose}_`);
    }
    parts.push(`\`\`\`${lang}`);
    parts.push(chunk.content);
    parts.push("```\n");
    remaining -= totalCost;
    fittedAny = true;
    renderedCount++;
  }

  // Two cases that both produce a "location-only" section:
  //
  //   1. Nothing fit → the old "All N matches exceed budget" fallback.
  //      We still need this because returning "No results found" for
  //      matches that exist but are oversized is actively misleading.
  //
  //   2. Some fit, some didn't → list the ones that didn't so the
  //      caller knows they exist. This is the bug-B fix.
  //
  // In both cases, compute the total tokens needed to fit everything
  // so we can suggest an exact budget value.
  if (!fittedAny) {
    const totalNeeded = chunks.reduce((sum, c) => {
      const headerCost = Math.ceil(80 / 3.5); // approximate header
      return sum + headerCost + c.token_count + 10;
    }, 0);
    parts.push(
      `_All ${chunks.length} match${chunks.length === 1 ? "" : "es"} exceed token_budget=${tokenBudget} (~${totalNeeded} tokens needed). ` +
      `Re-run with token_budget:${totalNeeded} or use Read for the full body._`
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
    locationOnlyCount = Math.min(chunks.length, 10);
  } else if (skipped.length > 0) {
    const skippedTokens = skipped.reduce((sum, c) => sum + c.token_count + 10, 0);
    const totalNeeded = tokenBudget - remaining + skippedTokens;
    parts.push("");
    parts.push(
      `_${skipped.length} additional match${skipped.length === 1 ? "" : "es"} didn't fit token_budget=${tokenBudget} (~${totalNeeded} tokens total). ` +
      `Re-run with token_budget:${totalNeeded} to include all._`
    );
    for (const chunk of skipped.slice(0, 10)) {
      const file = files.get(chunk.file_id);
      const filePath = chunk.filePath || file?.path || "unknown";
      const sig = chunk.signature ? `  \`${chunk.signature.trim()}\`` : "";
      parts.push(
        `- **${filePath}:${chunk.start_line}-${chunk.end_line}** (${chunk.type}: ${chunk.name}, ~${chunk.token_count} tokens)${sig}`
      );
    }
    locationOnlyCount = Math.min(skipped.length, 10);
    if (skipped.length > 10) {
      parts.push(`- _...and ${skipped.length - 10} more_`);
    }
  }

  const symbolLower = opts.symbol?.toLowerCase();
  const exactMatch =
    symbolLower !== undefined &&
    chunks.some((c) => c.name?.toLowerCase() === symbolLower);
  const confidence: EnoughnessConfidence =
    fittedAny && exactMatch && skipped.length === 0 ? "high" : "medium";
  parts.push("");
  parts.push(
    formatEnoughness({
      kind: "lookup",
      subject: opts.symbol,
      shown: renderedCount + locationOnlyCount,
      total: chunks.length,
      locationOnly: locationOnlyCount,
      tokenBudget,
      totalNeeded:
        skipped.length > 0 || !fittedAny
          ? chunks.reduce((sum, c) => sum + Math.ceil(80 / 3.5) + c.token_count + 10, 0)
          : undefined,
      confidence,
      refsChecked: false,
      testsChecked: false,
    })
  );

  return parts.join("\n");
}

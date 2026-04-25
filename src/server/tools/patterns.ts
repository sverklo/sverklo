import type { Indexer } from "../../indexer/indexer.js";
import { PATTERN_TAXONOMY, PATTERN_SET } from "../../storage/pattern-store.js";

// P2-17: query the pattern_edges table by pattern name. Returns symbols
// that the LLM tagged with a given design pattern, sorted by confidence.

export const patternsTool = {
  name: "sverklo_patterns",
  description:
    "Query the LLM-derived design-pattern annotations on indexed symbols. " +
    "Pass a `pattern` from the closed taxonomy (observer, repository, validator, ...) " +
    "to list every symbol tagged with it; pass no args to see the taxonomy + counts. " +
    "Requires `sverklo enrich-patterns` to have been run.",
  inputSchema: {
    type: "object" as const,
    properties: {
      pattern: {
        type: "string",
        description: `One of: ${PATTERN_TAXONOMY.join(", ")}.`,
      },
      limit: { type: "number", description: "Max rows to return (default 25)." },
    },
    required: [],
  },
};

export function handlePatterns(indexer: Indexer, args: Record<string, unknown>): string {
  let total = 0;
  try {
    total = indexer.patternStore.count();
  } catch {
    return "Pattern index missing. Run `sverklo enrich-patterns` after `ollama pull qwen2.5-coder:7b`.";
  }
  if (total === 0) {
    return "No pattern annotations yet. Run `sverklo enrich-patterns` to populate.";
  }

  const patternArg = args.pattern;
  if (typeof patternArg !== "string" || !patternArg.trim()) {
    // No pattern asked — return the taxonomy with per-pattern counts.
    return formatTaxonomyOverview(indexer);
  }

  const pattern = patternArg.trim();
  if (!PATTERN_SET.has(pattern)) {
    return `Unknown pattern '${pattern}'. Valid values: ${PATTERN_TAXONOMY.join(", ")}.`;
  }

  const limit = typeof args.limit === "number" ? args.limit : 25;
  const rows = indexer.patternStore.getByPattern(pattern, limit);
  if (rows.length === 0) {
    return `No symbols tagged with '${pattern}'.`;
  }

  const parts: string[] = [`## Symbols tagged \`${pattern}\` (${rows.length})`, ""];
  for (const r of rows) {
    const symbol = r.symbol_name ? r.symbol_name : "(anonymous)";
    const role = r.role ? ` · role: ${r.role}` : "";
    const conf = `conf ${r.confidence.toFixed(2)}`;
    parts.push(
      `- \`${r.file_path}:${r.start_line}-${r.end_line}\` [${r.chunk_type} ${symbol}] · ${conf}${role}`
    );
  }
  return parts.join("\n");
}

function formatTaxonomyOverview(indexer: Indexer): string {
  // Per-pattern counts via repeated lookups — taxonomy is small (~30).
  const parts: string[] = ["## Pattern taxonomy", ""];
  let total = 0;
  for (const p of PATTERN_TAXONOMY) {
    const rows = indexer.patternStore.getByPattern(p, 1000);
    if (rows.length === 0) continue;
    total += rows.length;
    parts.push(`- \`${p}\` — ${rows.length} symbol(s)`);
  }
  if (total === 0) {
    return "Pattern index is empty. Run `sverklo enrich-patterns`.";
  }
  parts.push("");
  parts.push(`_Total: ${total} annotation(s). Pass \`pattern:"<name>"\` to list each._`);
  return parts.join("\n");
}

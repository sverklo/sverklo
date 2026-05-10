import type { IndexFiles } from "../../indexer/index-files.js";
import type { IndexCode } from "../../indexer/index-code.js";
import type { FileRecord, SearchResult, CodeChunk } from "../../types/index.js";
import { resolveBudget } from "../../utils/budget.js";
import { rerank, rerankerConfigFromEnv } from "../../search/rerank.js";

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

export async function handleFindReferences(
  indexer: IndexFiles & IndexCode,
  args: Record<string, unknown>
): Promise<string> {
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
  //
  // Issue #28 (lodash P2 regression): the FTS candidate set used to be
  // capped at 50. Post-v0.20.2 the parser emits ~2× more chunks per
  // large file (lodash.js: 238 → 486). Smaller chunks score higher
  // per-keyword density, so a single file with the symbol scattered
  // across many chunks (e.g. lodash.js for "filter") could saturate
  // all 50 slots and evict references in other files (fp/*, test/*,
  // etc.). Recall on lodash P2 dropped from ~0.50 to ~0.20.
  //
  // Two-part fix:
  //   1. Pull a larger candidate set (500) so file diversity has room.
  //   2. Cap chunks-per-file at 8 — way more than any single P2 task
  //      needs, while preventing one file from monopolizing the budget.
  // Token-budget output cap below still bounds the final size.
  const FTS_CANDIDATE_LIMIT = 500;
  const PER_FILE_CHUNK_CAP = 8;
  const ftsResults = indexer.chunkStore.searchFts(symbol, FTS_CANDIDATE_LIMIT);

  const fileCache = new Map<number, FileRecord>();
  for (const f of indexer.fileStore.getAll()) {
    fileCache.set(f.id, f);
  }

  // Group by file. Per-file cap enforced as we iterate (FTS returns
  // chunks in rank order, so the kept chunks are the highest-ranked
  // for each file).
  const byFile = new Map<string, { line: number; context: string; type: string }[]>();
  const perFileChunkCount = new Map<number, number>();
  // Track the highest-ranked chunk per file (the first one we
  // accept under the matcher). Used as the rerank input below so
  // file ordering can be reranked by MaxSim instead of PageRank.
  const firstChunkPerFile = new Map<string, typeof ftsResults[number]>();

  for (const chunk of ftsResults) {
    const file = fileCache.get(chunk.file_id);
    if (!file) continue;

    // Per-file cap: if this file has already contributed
    // PER_FILE_CHUNK_CAP chunks to the candidate set, skip further
    // chunks from it. The earlier chunks (higher FTS rank) win.
    const fileCount = perFileChunkCount.get(chunk.file_id) || 0;
    if (fileCount >= PER_FILE_CHUNK_CAP) continue;

    // Early reject: if the symbol doesn't appear in the chunk at all
    // (under the current matching mode), skip the per-line scan.
    // Note: we still count this against the cap to avoid pathological
    // cases where every candidate is a false-positive content match.
    if (!matches(chunk.content)) continue;

    perFileChunkCount.set(chunk.file_id, fileCount + 1);
    if (!firstChunkPerFile.has(file.path)) {
      firstChunkPerFile.set(file.path, chunk);
    }

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

  // Sort files. Default: by PageRank. With SVERKLO_RERANK set,
  // run the highest-ranked chunk per file through MaxSim and order
  // by rerank score instead — keeps file diversity (one chunk per
  // file maximum, so a chunky file can't monopolize the candidates).
  // Issue #29 wiring: this is the second of two paths the bench
  // primitives now exercise (the first is sverklo_lookup).
  let sortedFiles: [string, { line: number; context: string; type: string }[]][];
  const refsRerankConfig = rerankerConfigFromEnv();
  if (refsRerankConfig.mode !== "off" && firstChunkPerFile.size > 1) {
    const filePaths = [...firstChunkPerFile.keys()];
    const candidates: SearchResult[] = filePaths.map((path) => {
      const chunk = firstChunkPerFile.get(path)!;
      const file = fileCache.get(chunk.file_id);
      return {
        chunk: chunk as unknown as CodeChunk,
        file: file ?? {
          id: chunk.file_id,
          path,
          language: null,
          hash: "",
          last_modified: 0,
          size_bytes: 0,
          pagerank: 0,
          indexed_at: 0,
        },
        score: 0,
      };
    });
    const reranked = await rerank(symbol, candidates, {
      ...refsRerankConfig,
      topK: filePaths.length, // keep all files; we're reordering, not pruning
      candidatePool: filePaths.length,
    });
    // Build path → rerank-score map (sidecar __rerankScore set by rerank()).
    const scoreByPath = new Map<string, number>();
    for (const r of reranked) {
      const sidecar = (r as unknown as { __rerankScore?: number }).__rerankScore;
      scoreByPath.set(r.file.path, typeof sidecar === "number" ? sidecar : 0);
    }
    sortedFiles = [...byFile.entries()].sort((a, b) => {
      const sa = scoreByPath.get(a[0]) ?? -Infinity;
      const sb = scoreByPath.get(b[0]) ?? -Infinity;
      if (sa !== sb) return sb - sa;
      // Tie-break by PageRank for determinism.
      const fileA = fileCache.get(firstChunkPerFile.get(a[0])?.file_id ?? -1);
      const fileB = fileCache.get(firstChunkPerFile.get(b[0])?.file_id ?? -1);
      return (fileB?.pagerank || 0) - (fileA?.pagerank || 0);
    });
  } else {
    sortedFiles = [...byFile.entries()].sort((a, b) => {
      const fileA = [...fileCache.values()].find((f) => f.path === a[0]);
      const fileB = [...fileCache.values()].find((f) => f.path === b[0]);
      return (fileB?.pagerank || 0) - (fileA?.pagerank || 0);
    });
  }

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

  // Append doc mentions (v0.13, P0-5). If any markdown / README / ADR
  // chunks reference this symbol by backtick or fenced code, surface them
  // so the agent sees both the code and its documentation together.
  try {
    const docMentions = indexer.docEdgeStore.getBySymbol(symbol, 20);
    if (docMentions.length > 0) {
      // Sprint 9: split structural inclusions from associative references
      // so callers see "this is where the symbol is documented" separately
      // from "see also" mentions. Also dedup rows that point at the same
      // logical doc location: when both an outer fenced chunk and the
      // inner fence resolve to the symbol we'd otherwise emit two near-
      // identical lines (same file, same breadcrumb, off-by-one ranges).
      const seen = new Set<string>();
      const dedupedAll: typeof docMentions = [];
      for (const m of docMentions) {
        const key = `${m.doc_file_path}|${m.doc_breadcrumb ?? ""}|${m.match_kind}`;
        if (seen.has(key)) continue;
        seen.add(key);
        dedupedAll.push(m);
      }

      const includes = dedupedAll.filter((m) => m.edge_kind === "includes");
      const references = dedupedAll.filter((m) => m.edge_kind !== "includes");

      const renderRow = (m: typeof docMentions[number]): string => {
        const breadcrumb = m.doc_breadcrumb ? ` — "${m.doc_breadcrumb}"` : "";
        const confTag = m.confidence >= 1 ? "" : ` (conf ${m.confidence.toFixed(1)})`;
        return `- ${m.doc_file_path}:${m.doc_start_line}-${m.doc_end_line}${breadcrumb} [${m.match_kind}]${confTag}`;
      };

      if (includes.length > 0) {
        parts.push(`## Doc mentions — includes (${includes.length})`);
        for (const m of includes.slice(0, 10)) parts.push(renderRow(m));
        parts.push("");
      }
      if (references.length > 0) {
        parts.push(`## Doc mentions — references (${references.length})`);
        for (const m of references.slice(0, 10)) parts.push(renderRow(m));
        parts.push("");
      }
    }
  } catch {
    // Pre-v3 db or doc_mentions table missing — skip silently.
  }

  return parts.length > 1 ? parts.join("\n") : `No references found for '${symbol}'.`;
}

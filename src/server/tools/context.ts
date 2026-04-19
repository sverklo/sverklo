// sverklo_context: umbrella "give me everything relevant to this task" tool.
//
// Inspired by code-review-graph's get_minimal_context. Instead of forcing the
// model to chain 5-8 atomic calls (overview → search → lookup → recall → ...)
// for common code-intelligence questions, this returns a single curated
// bundle in one round trip. The model can still drill down with the atomic
// tools afterward — this is the "front door".
//
// detail_level controls how much:
//   minimal — overview header + top 3 search hits + top 2 memories
//   normal  — overview header + top 5 search hits + top 5 memories + symbol table
//   full    — normal + dependency neighbours of top results

import type { Indexer } from "../../indexer/indexer.js";
import { hybridSearch } from "../../search/hybrid-search.js";
import { handleRecall } from "./recall.js";
import { estimateTokens } from "../../utils/tokens.js";
import type { CodeChunk, FileRecord } from "../../types/index.js";

export const contextTool = {
  name: "sverklo_context",
  description:
    "Umbrella context bundler. Give a task description and get a single curated bundle: " +
    "codebase overview header, semantically relevant code, related symbols, and matching " +
    "saved memories — in one round trip. Use this as the FIRST call when you start working " +
    "on a new task and want to orient quickly. " +
    "PASS `budget` for a PageRank-pruned repo map fit to a token budget — the ideal way " +
    "to give an agent a complete mental model of an unfamiliar codebase in one call.",
  inputSchema: {
    type: "object" as const,
    properties: {
      task: {
        type: "string",
        description:
          "Free-form description of what you're trying to do, e.g. 'add rate limiting to the login endpoint' or 'understand how billing webhooks are processed'. When `budget` is set and no task is given, returns a pure PageRank-ordered repo map.",
      },
      detail_level: {
        type: "string",
        enum: ["minimal", "normal", "full"],
        description:
          "How much to return. minimal=fast/cheap (good for snap orientation); normal=balanced (default); full=adds dependency neighbours. Ignored when `budget` is set.",
      },
      scope: {
        type: "string",
        description: "Optional path prefix to constrain the search (e.g. 'src/api/').",
      },
      budget: {
        type: "number",
        description:
          "When set, returns a PageRank-pruned repo map greedily filled to this token budget (inspired by aider's repo-map). Files are ordered by PageRank importance, optionally biased toward `task`. Only symbol signatures are rendered — use the atomic tools for full bodies. Typical values: 4000 (snap map), 8000 (full mental model), 16000 (deep context).",
      },
      exclude: {
        type: "array",
        items: { type: "string" },
        description: "Path substrings to exclude from the repo map (e.g. ['test', 'migration']).",
      },
    },
  },
};

type DetailLevel = "minimal" | "normal" | "full";

export async function handleContext(
  indexer: Indexer,
  args: Record<string, unknown>
): Promise<string> {
  const task = (args.task as string)?.trim() || "";
  const detail = ((args.detail_level as string) || "normal") as DetailLevel;
  const scope = args.scope as string | undefined;
  const budget = args.budget as number | undefined;
  const exclude = (args.exclude as string[] | undefined) || [];

  // ── Budget mode: PageRank-pruned repo map (issue #8) ──────────────
  // When budget is set, we skip the standard search-based bundler and
  // instead build a dense structural map greedily filled to the target
  // token count. This is the "give the agent a complete mental model
  // of an unfamiliar repo in one call" path — aider's repo-map pattern.
  if (typeof budget === "number" && budget > 0) {
    return await buildPrunedRepoMap(indexer, {
      budget,
      task,
      scope,
      exclude,
    });
  }

  if (!task) {
    return "Error: `task` is required (unless you pass `budget` for a pure repo map).";
  }

  const searchLimit = detail === "minimal" ? 3 : detail === "normal" ? 5 : 8;
  const memoryLimit = detail === "minimal" ? 2 : 5;
  const tokenBudget = detail === "minimal" ? 1500 : detail === "normal" ? 3000 : 5000;

  const parts: string[] = [];
  parts.push(`# ${task}`);
  parts.push(`_${detail}${scope ? ` · ${scope}` : ""}_`);
  parts.push("");

  // ─── 1. Codebase header ────────────────────────────────────────────
  const status = indexer.getStatus();
  parts.push(`## repo`);
  parts.push(
    `${status.projectName} · ${status.fileCount} files · ${status.chunkCount} symbols · ${status.languages.slice(0, 4).join(", ") || "—"}`
  );

  // Core memories surface as project invariants — always include them.
  const coreMemories = indexer.memoryStore.getCore(detail === "minimal" ? 3 : 6);
  if (coreMemories.length > 0) {
    parts.push("");
    parts.push("## invariants");
    for (const m of coreMemories) {
      const stale = m.is_stale ? " [STALE]" : "";
      parts.push(`- [${m.category}]${stale} ${m.content}`);
    }
  }
  parts.push("");

  // ─── 2. Semantically relevant code ─────────────────────────────────
  const searchResults = await hybridSearch(indexer, {
    query: task,
    tokenBudget,
    scope,
    type: "any",
  });
  const topResults = searchResults.slice(0, searchLimit);

  if (topResults.length > 0) {
    parts.push(`## code (${topResults.length})`);
    const fileCache = new Map(indexer.fileStore.getAll().map((f) => [f.id, f]));
    for (const r of topResults) {
      const file = fileCache.get(r.chunk.file_id);
      const path = file?.path || "unknown";
      const pr = file ? ` (PR ${file.pagerank.toFixed(2)})` : "";
      const label = r.chunk.name
        ? `${r.chunk.type} **${r.chunk.name}**`
        : `${r.chunk.type}`;
      parts.push(`- ${label} @ \`${path}:${r.chunk.start_line}\`${pr}`);
      if (r.chunk.signature) {
        parts.push(`  \`${r.chunk.signature.slice(0, 120)}\``);
      }
    }
    parts.push("");

    // ─── 3. (full only) Dependency neighbours ────────────────────────
    if (detail === "full") {
      const seen = new Set<number>();
      const neighbours: { from: string; to: string; via: "imports" | "imported-by" }[] = [];
      for (const r of topResults.slice(0, 3)) {
        const fileId = r.chunk.file_id;
        if (seen.has(fileId)) continue;
        seen.add(fileId);
        const file = fileCache.get(fileId);
        if (!file) continue;

        for (const edge of indexer.graphStore.getImports(fileId).slice(0, 4)) {
          const target = fileCache.get(edge.target_file_id);
          if (target) {
            neighbours.push({ from: file.path, to: target.path, via: "imports" });
          }
        }
        for (const edge of indexer.graphStore.getImporters(fileId).slice(0, 4)) {
          const source = fileCache.get(edge.source_file_id);
          if (source) {
            neighbours.push({ from: source.path, to: file.path, via: "imported-by" });
          }
        }
      }
      if (neighbours.length > 0) {
        parts.push(`## deps`);
        for (const n of neighbours) {
          const arrow = n.via === "imports" ? "→" : "←";
          parts.push(`- \`${n.from}\` ${arrow} \`${n.to}\``);
        }
        parts.push("");
      }
    }
  } else {
    parts.push(`_No matches for "${task}". Try a narrower query or broaden scope._`);
    parts.push("");
  }

  // ─── 4. Related memories ──────────────────────────────────────────
  // Use the existing recall handler so we get the same RRF + staleness logic.
  // It returns formatted markdown; if it says "No memories found.", skip the section.
  try {
    const recallOut = await handleRecall(indexer, { query: task, limit: memoryLimit });
    if (recallOut && recallOut !== "No memories found.") {
      parts.push(`## Related memories`);
      parts.push(recallOut.trim());
      parts.push("");
    }
  } catch {
    // recall failures shouldn't block the bundle — silently skip
  }

  // ─── 5. Suggested next moves ───────────────────────────────────────
  parts.push("## Suggested next");
  if (topResults.length > 0) {
    const top = topResults[0];
    if (top.chunk.name) {
      parts.push(`- \`sverklo_refs symbol:"${top.chunk.name}"\` to see who uses the most relevant symbol`);
      parts.push(`- \`sverklo_lookup name:"${top.chunk.name}"\` for the full definition`);
    }
  }
  parts.push(`- \`sverklo_search query:"<more specific term>"\` to drill into a sub-area`);
  if (detail !== "full") {
    parts.push(`- Re-run with \`detail_level:"full"\` to also see dependency neighbours`);
  }

  return parts.join("\n");
}

// ─────────────────────────────────────────────────────────────────────
// Issue #8 — PageRank-pruned repo map fit to a token budget.
//
// Design (mirrors aider's repo-map, adapted to sverklo's symbol graph):
//
//   1. Rank files by PageRank DESC.
//   2. If a task was provided, run a semantic search and upweight files
//      that contain strong matches. This lets the map center on the
//      subsystem the user is working in, instead of always the global
//      hub files.
//   3. Walk files in ranked order; for each, render signatures of its
//      most important symbols (also ordered by PageRank proxy).
//   4. Greedily fill the budget. Stop the instant adding the next file
//      would exceed the cap. The output is deterministic given the
//      same index state and budget — important for caching.
//
// Determinism note: we break PageRank ties by file path to keep output
// stable across runs of the same input. This matters for caching and
// snapshot-testing downstream.
// ─────────────────────────────────────────────────────────────────────

// Upper bound on the repo-map budget. Anything above 32k tokens is
// almost certainly a mistake — the resulting map won't fit in any
// current model's context window and the wall-clock cost of walking
// every file climbs linearly. We cap and emit a warning in the
// output so the caller knows we trimmed.
const MAX_REPO_MAP_BUDGET = 32000;
const MIN_REPO_MAP_BUDGET = 500;

async function buildPrunedRepoMap(
  indexer: Indexer,
  opts: {
    budget: number;
    task: string;
    scope?: string;
    exclude: string[];
  }
): Promise<string> {
  let { budget } = opts;
  const { task, scope, exclude } = opts;

  // Clamp the budget to sane bounds. Sub-500 can't even fit a header
  // + one file meaningfully; over 32k is nearly always unintentional.
  let budgetWarning = "";
  if (budget > MAX_REPO_MAP_BUDGET) {
    budgetWarning = `_Budget ${budget} exceeded max ${MAX_REPO_MAP_BUDGET} — clamped. For larger maps, use multiple scoped calls._\n\n`;
    budget = MAX_REPO_MAP_BUDGET;
  } else if (budget < MIN_REPO_MAP_BUDGET) {
    return (
      `Budget too small: ${budget}. Minimum is ${MIN_REPO_MAP_BUDGET} tokens — ` +
      `below that the repo map can't fit a useful number of files. ` +
      `Try \`budget: ${MIN_REPO_MAP_BUDGET}\` for a snap view.`
    );
  }

  // Pull all files sorted by PageRank. file_store.getAll() already
  // returns them in pagerank DESC order — see storage/file-store.ts.
  let files: FileRecord[] = indexer.fileStore.getAll();

  // Apply scope prefix and exclude substrings.
  if (scope) {
    files = files.filter((f) => f.path.startsWith(scope));
  }
  if (exclude.length > 0) {
    files = files.filter((f) => !exclude.some((ex) => f.path.includes(ex)));
  }

  // Task-biased reranking: if the caller gave us a task, run a search
  // and boost files that contain strong matches. We keep the PageRank
  // signal as the primary order and only use the task signal as a
  // tiebreaker / boost — so the output is still dominated by the
  // structural importance of the codebase, not by query noise.
  const taskBoost = new Map<number, number>();
  if (task) {
    try {
      const hits = await hybridSearch(indexer, {
        query: task,
        tokenBudget: 50000, // ask for a lot so boost is meaningful
        scope,
        type: "any",
      });
      // Accumulate score per file across all hits.
      for (const h of hits) {
        taskBoost.set(h.chunk.file_id, (taskBoost.get(h.chunk.file_id) || 0) + h.score);
      }
    } catch {
      // Fall back to pure PageRank if search fails — never block the map.
    }
  }

  // Stable ranking: compose PageRank with the task boost, break ties
  // by path so the same input always produces the same output.
  const ranked = [...files].sort((a, b) => {
    const ba = (taskBoost.get(a.id) || 0) * 0.5 + a.pagerank;
    const bb = (taskBoost.get(b.id) || 0) * 0.5 + b.pagerank;
    if (bb !== ba) return bb - ba;
    return a.path.localeCompare(b.path);
  });

  // Header first so the caller can still see the budget and ordering
  // even when the budget is tiny and zero files fit.
  const parts: string[] = [];
  parts.push(
    `# Repo map${task ? ` · centered on: ${task}` : ""}${scope ? ` · scope: ${scope}` : ""}`
  );
  parts.push(
    `_Budget: ${budget} tokens · ordered by PageRank${task ? " + task relevance" : ""}._`
  );
  if (budgetWarning) parts.push(budgetWarning);
  parts.push("");

  // Remaining budget after the header. 10% cushion for the trailing
  // footer text and any rendering slack. Token estimates are rough —
  // we use the same estimator as the indexer (chars / 3.5).
  const headerCost = estimateTokens(parts.join("\n"));
  let remaining = budget - headerCost - 100;

  let filesRendered = 0;
  let filesSkipped = 0;

  for (const file of ranked) {
    if (remaining <= 0) {
      filesSkipped = ranked.length - filesRendered;
      break;
    }

    // Pull the file's symbols. We only render symbol signatures
    // (cheap) plus the symbol's name and type. Full bodies would
    // blow the budget instantly — the point of a map is to be a
    // legend, not the terrain.
    const chunks: CodeChunk[] = indexer.chunkStore
      .getByFile(file.id)
      .filter((c) => c.name);

    if (chunks.length === 0) continue;

    // Render the file's entry. Symbols are ordered as they appear in
    // the file (by start_line). Top-level types/classes come first in
    // most codebases so this matches how a human skims.
    const fileHeader = `## \`${file.path}\` · PR ${file.pagerank.toFixed(3)} · ${file.language || "?"}`;
    const fileLines: string[] = [fileHeader];

    // Soft cap on symbols-per-file so one massive file doesn't eat the
    // whole budget. Files with >40 symbols render as "+ N more".
    const CAP_PER_FILE = 40;
    const shown = chunks.slice(0, CAP_PER_FILE);

    for (const c of shown) {
      const sig = c.signature ? c.signature.trim() : `${c.type} ${c.name}`;
      // Keep each line short — the map should scan like an outline.
      const truncated = sig.length > 110 ? sig.slice(0, 107) + "..." : sig;
      fileLines.push(`- ${truncated}`);
    }
    if (chunks.length > CAP_PER_FILE) {
      fileLines.push(`- _...and ${chunks.length - CAP_PER_FILE} more symbols_`);
    }

    const entry = fileLines.join("\n") + "\n";
    const cost = estimateTokens(entry);

    // If a single file's entry exceeds the remaining budget, render a
    // truncated version (just the header + symbol count) so the caller
    // still knows the file exists. Never render a partial entry with
    // half its symbols cut off — that's confusing.
    if (cost > remaining) {
      const fallback =
        `## \`${file.path}\` · PR ${file.pagerank.toFixed(3)}\n` +
        `- _${chunks.length} symbols (budget exhausted — use sverklo_lookup for details)_\n`;
      const fallbackCost = estimateTokens(fallback);
      if (fallbackCost <= remaining) {
        parts.push(fallback);
        remaining -= fallbackCost;
        filesRendered++;
      } else {
        filesSkipped = ranked.length - filesRendered;
        break;
      }
    } else {
      parts.push(entry);
      remaining -= cost;
      filesRendered++;
    }
  }

  // Footer
  parts.push("");
  parts.push(
    `_Rendered ${filesRendered} of ${ranked.length} files` +
      (filesSkipped > 0
        ? ` (${filesSkipped} skipped — budget exhausted; raise \`budget\` to see more)_`
        : "_")
  );
  if (filesRendered > 0) {
    parts.push(
      "_Use `sverklo_lookup name:<symbol>` or `sverklo_search query:<...>` to drill into any symbol._"
    );
  }

  return parts.join("\n");
}

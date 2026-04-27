import { readFileSync } from "node:fs";
import { dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
// Import from compiled dist — research eval runs outside the TypeScript
// build graph, so we load the JS built by `npm run build`.
import { Indexer } from "../../../dist/src/indexer/indexer.js";
import { getProjectConfig } from "../../../dist/src/utils/config.js";
import { runInvestigate } from "../../../dist/src/search/investigate.js";
import type {
  ResearchTask,
  ResearchHit,
  ResearchScore,
  ResearchRunSummary,
  RequiredEvidence,
} from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_DATASETS_DIR = resolve(__dirname, "datasets");

export interface RunResearchOpts {
  /** Path to the repo under test. Defaults to sverklo's own repo. */
  repoRoot: string;
  /** JSONL file (absolute or relative to datasets dir). */
  datasetPath?: string;
  /** Cap — set e.g. 3 while iterating locally. */
  maxTasks?: number;
  /** Write a JSON report next to the dataset. Default: stdout only. */
  writeReport?: boolean;
  /** Pass-through to runInvestigate's expandGraph option (P1-9). */
  expandGraph?: boolean;
  /** Pass-through to runInvestigate's expandUpstream option (v0.18 god-file channel). */
  expandUpstream?: boolean;
}

export async function runResearchBench(opts: RunResearchOpts): Promise<ResearchRunSummary> {
  const tasks = loadTasks(opts.datasetPath ?? resolve(DEFAULT_DATASETS_DIR, "sverklo.jsonl"));
  const cap = opts.maxTasks ?? tasks.length;
  const target = tasks.slice(0, cap);

  const config = getProjectConfig(opts.repoRoot);
  const indexer = new Indexer(config);
  await indexer.index();

  const scores: ResearchScore[] = [];
  for (const task of target) {
    const start = Date.now();
    const result = await runInvestigate(indexer, {
      query: task.question,
      budget: 50,
      expandGraph: opts.expandGraph,
      expandUpstream: opts.expandUpstream,
    });
    const duration = Date.now() - start;

    // Cap at 50 hits — what a research-style answer can plausibly hold
    // in context. Cutting earlier hides legitimate recall; cutting later
    // measures retrieval that an agent couldn't actually use.
    const hits: ResearchHit[] = result.hits.slice(0, 50).map((h) => ({
      file: h.file.path,
      symbol: h.chunk.name,
      start_line: h.chunk.start_line,
      end_line: h.chunk.end_line,
      score: h.score,
    }));

    scores.push(scoreTask(task, hits, duration));
  }

  indexer.close();

  return summarise(scores, basename(opts.datasetPath ?? "sverklo.jsonl"));
}

function loadTasks(path: string): ResearchTask[] {
  const raw = readFileSync(path, "utf-8");
  const tasks: ResearchTask[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    tasks.push(JSON.parse(t) as ResearchTask);
  }
  return tasks;
}

export function scoreTask(
  task: ResearchTask,
  hits: ResearchHit[],
  duration_ms: number
): ResearchScore {
  const required = task.required_evidence;
  const matched: RequiredEvidence[] = [];
  const missed: RequiredEvidence[] = [];
  // Track which hits "covered" at least one requirement so wasted_hits
  // counts only hits that satisfied nothing. We deliberately do NOT
  // require disjoint hits per requirement: a single chunk can simultaneously
  // satisfy a `{file}` requirement AND a `{file, symbol}` requirement when
  // both specifiers match — that's not double-counting, it's the chunk
  // genuinely demonstrating both invariants.
  const coveredHitIdx = new Set<number>();

  for (const req of required) {
    const hitIdx = hits.findIndex((h) => matches(req, h));
    if (hitIdx >= 0) {
      matched.push(req);
      coveredHitIdx.add(hitIdx);
    } else {
      missed.push(req);
    }
  }

  return {
    task_id: task.id,
    recall: required.length === 0 ? 1 : matched.length / required.length,
    total_hits: hits.length,
    wasted_hits: Math.max(0, hits.length - coveredHitIdx.size),
    matched,
    missed,
    duration_ms,
  };
}

function matches(req: RequiredEvidence, hit: ResearchHit): boolean {
  if (hit.file !== req.file) return false;
  if (req.symbol && hit.symbol !== req.symbol) return false;
  if (req.line_range) {
    const [start, end] = req.line_range;
    // Overlap check: any line of the hit falls inside the required range.
    if (hit.end_line < start || hit.start_line > end) return false;
  }
  return true;
}

function summarise(scores: ResearchScore[], dataset: string): ResearchRunSummary {
  if (scores.length === 0) {
    return {
      dataset,
      total_tasks: 0,
      avg_recall: 0,
      perfect_recall: 0,
      avg_wasted_hits: 0,
      avg_duration_ms: 0,
      scores,
    };
  }
  const avg = (xs: number[]): number =>
    xs.reduce((s, x) => s + x, 0) / xs.length;

  return {
    dataset,
    total_tasks: scores.length,
    avg_recall: avg(scores.map((s) => s.recall)),
    perfect_recall: scores.filter((s) => s.recall === 1).length,
    avg_wasted_hits: avg(scores.map((s) => s.wasted_hits)),
    avg_duration_ms: avg(scores.map((s) => s.duration_ms)),
    scores,
  };
}

export function formatReport(summary: ResearchRunSummary): string {
  const parts: string[] = [];
  parts.push(
    `# Research eval — ${summary.dataset} (${summary.total_tasks} tasks)`
  );
  parts.push("");
  parts.push(`**avg recall:** ${(summary.avg_recall * 100).toFixed(1)}%`);
  parts.push(`**perfect recall:** ${summary.perfect_recall}/${summary.total_tasks}`);
  parts.push(`**avg wasted hits:** ${summary.avg_wasted_hits.toFixed(1)}`);
  parts.push(`**avg duration:** ${summary.avg_duration_ms.toFixed(0)} ms`);
  parts.push("");
  parts.push("| Task | Recall | Hits | Wasted | ms |");
  parts.push("|---|---|---|---|---|");
  for (const s of summary.scores) {
    parts.push(
      `| ${s.task_id} | ${(s.recall * 100).toFixed(0)}% | ${s.total_hits} | ${s.wasted_hits} | ${s.duration_ms} |`
    );
  }

  const failures = summary.scores.filter((s) => s.recall < 1);
  if (failures.length > 0) {
    parts.push("");
    parts.push("## Missed evidence (recall < 1.0)");
    for (const f of failures) {
      parts.push(`- **${f.task_id}**: missed ${f.missed.length} of ${f.missed.length + f.matched.length}`);
      for (const m of f.missed) {
        const sym = m.symbol ? ` · ${m.symbol}` : "";
        parts.push(`    - ${m.file}${sym}`);
      }
    }
  }

  return parts.join("\n");
}

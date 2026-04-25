import { readFileSync } from "node:fs";
import { dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { Indexer } from "../../../dist/src/indexer/indexer.js";
import { getProjectConfig } from "../../../dist/src/utils/config.js";
import type { PatternTask, PatternScore, PatternRunSummary } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_DATASETS_DIR = resolve(__dirname, "datasets");

export interface RunPatternBenchOpts {
  repoRoot: string;
  datasetPath?: string;
}

/**
 * Read the live `pattern_edges` table and score it against the ground
 * truth. Tasks where the labeler hadn't tagged the symbol at all are
 * surfaced as "scored=0 / not run", separately from precision/recall —
 * that distinguishes "labeler said nothing" (likely needs a re-run)
 * from "labeler said the wrong thing".
 */
export async function runPatternBench(opts: RunPatternBenchOpts): Promise<PatternRunSummary> {
  const path = opts.datasetPath ?? resolve(DEFAULT_DATASETS_DIR, "sverklo.jsonl");
  const tasks = readTasks(path);

  const config = getProjectConfig(opts.repoRoot);
  const indexer = new Indexer(config);
  await indexer.index();

  const scores: PatternScore[] = [];
  for (const task of tasks) {
    const file = indexer.fileStore.getAll().find((f) => f.path === task.file);
    if (!file) {
      scores.push(zeroScore(task, "file_missing"));
      continue;
    }
    const chunk = indexer.chunkStore
      .getByFile(file.id)
      .find((c) => c.name === task.symbol);
    if (!chunk) {
      scores.push(zeroScore(task, "symbol_missing"));
      continue;
    }
    const edges = indexer.patternStore.getByChunk(chunk.id);
    const found = edges.map((e) => e.pattern);
    const matched = task.expected.filter((p) => found.includes(p));
    const forbiddenHits = (task.forbidden ?? []).filter((p) => found.includes(p)).length;
    scores.push({
      symbol: task.symbol,
      file: task.file,
      expected: task.expected,
      forbidden: task.forbidden ?? [],
      found,
      recall: task.expected.length === 0 ? 1 : matched.length / task.expected.length,
      precision: found.length === 0 ? 1 : matched.length / found.length,
      forbidden_hits: forbiddenHits,
    });
  }

  indexer.close();
  return summarise(scores, basename(path));
}

function readTasks(path: string): PatternTask[] {
  const raw = readFileSync(path, "utf-8");
  const out: PatternTask[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    out.push(JSON.parse(t) as PatternTask);
  }
  return out;
}

function zeroScore(task: PatternTask, _reason: string): PatternScore {
  return {
    symbol: task.symbol,
    file: task.file,
    expected: task.expected,
    forbidden: task.forbidden ?? [],
    found: [],
    recall: 0,
    precision: 0,
    forbidden_hits: 0,
  };
}

function summarise(scores: PatternScore[], _dataset: string): PatternRunSummary {
  const scored = scores.filter((s) => s.found.length > 0);
  const avg = (xs: number[]): number =>
    xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
  return {
    total_tasks: scores.length,
    scored_tasks: scored.length,
    avg_recall: avg(scored.map((s) => s.recall)),
    avg_precision: avg(scored.map((s) => s.precision)),
    forbidden_hits_total: scores.reduce((s, sc) => s + sc.forbidden_hits, 0),
    scores,
  };
}

export function formatReport(summary: PatternRunSummary): string {
  const parts: string[] = [];
  parts.push(`# Pattern eval — ${summary.total_tasks} task(s), ${summary.scored_tasks} scored`);
  parts.push("");
  parts.push(`**avg recall** (over scored): ${(summary.avg_recall * 100).toFixed(1)}%`);
  parts.push(`**avg precision** (over scored): ${(summary.avg_precision * 100).toFixed(1)}%`);
  parts.push(`**forbidden hits** (false positives): ${summary.forbidden_hits_total}`);
  parts.push("");
  parts.push("| Symbol | File | Expected | Found | Recall | Precision | FP |");
  parts.push("|---|---|---|---|---|---|---|");
  for (const s of summary.scores) {
    parts.push(
      `| ${s.symbol} | ${s.file} | ${s.expected.join(",") || "—"} | ${s.found.join(",") || "—"} | ${(s.recall * 100).toFixed(0)}% | ${(s.precision * 100).toFixed(0)}% | ${s.forbidden_hits} |`
    );
  }
  return parts.join("\n");
}

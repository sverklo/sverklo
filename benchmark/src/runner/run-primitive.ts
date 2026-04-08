import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Task, RunResult, Dataset } from "../types.ts";
import type { Baseline } from "../baselines/base.ts";
import { score } from "./score.ts";
import { NaiveGrepBaseline } from "../baselines/naive-grep.ts";
import { SmartGrepBaseline } from "../baselines/smart-grep.ts";
import { SverkloBaseline } from "../baselines/sverklo.ts";
import { loadJsonl } from "../ground-truth/schema.ts";
import { loadManifest } from "../datasets/fetch.ts";
import { generateExpressTasks } from "../ground-truth/seed/express.gen.ts";
import { writeReport } from "./report.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SVERKLO_ROOT = resolve(__dirname, "..", "..", "..");

export async function runAll(): Promise<void> {
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = join(SVERKLO_ROOT, "benchmark", "results", runId);
  mkdirSync(outDir, { recursive: true });

  console.error(`[bench] run ${runId}`);
  console.error(`[bench] resolving datasets`);
  const datasets: Dataset[] = loadManifest();

  // Build the task list per dataset
  const tasksByDataset = new Map<string, Task[]>();
  for (const d of datasets) {
    if (d.name === "sverklo") {
      tasksByDataset.set(
        d.name,
        loadJsonl(join(SVERKLO_ROOT, "benchmark", "src", "ground-truth", "seed", "sverklo.jsonl"))
      );
    } else if (d.name === "express") {
      console.error(`[bench] generating express ground truth`);
      tasksByDataset.set(d.name, generateExpressTasks(d.rootPath));
    }
  }

  const baselines: Baseline[] = [
    new NaiveGrepBaseline(),
    new SmartGrepBaseline(),
    new SverkloBaseline(),
  ];

  const results: RunResult[] = [];
  const rawPath = join(outDir, "raw.jsonl");
  const rawHandle: string[] = [];

  for (const dataset of datasets) {
    const tasks = tasksByDataset.get(dataset.name) || [];
    console.error(`[bench] dataset=${dataset.name} tasks=${tasks.length}`);
    for (const baseline of baselines) {
      console.error(`[bench]   baseline=${baseline.name} setup…`);
      try {
        await baseline.setupForDataset(dataset);
      } catch (e: any) {
        console.error(`[bench]   setup failed: ${e?.message || e}`);
        if (baseline.teardownForDataset) await baseline.teardownForDataset();
        continue;
      }
      for (const task of tasks) {
        process.stderr.write(`[bench]     ${task.id} `);
        let result: RunResult;
        try {
          const bo = await baseline.run(task);
          const metrics = score(task, bo.prediction, bo);
          result = {
            task_id: task.id,
            category: task.category,
            dataset: dataset.name,
            baseline: baseline.name,
            metrics,
            predicted_summary: summarize(bo.prediction),
          };
          process.stderr.write(`f1=${metrics.f1.toFixed(2)} tok=${metrics.input_tokens}\n`);
        } catch (e: any) {
          process.stderr.write(`ERROR ${e?.message || e}\n`);
          result = {
            task_id: task.id,
            category: task.category,
            dataset: dataset.name,
            baseline: baseline.name,
            metrics: {
              input_tokens: 0, tool_calls: 0, wall_time_ms: 0, cold_start_ms: 0,
              warm_call_ms: 0, recall: 0, precision: 0, f1: 0, exact_match: false,
              tokens_per_correct_answer: 0, notes: `error: ${e?.message || e}`,
            },
          };
        }
        results.push(result);
        rawHandle.push(JSON.stringify(result));
      }
      if (baseline.teardownForDataset) await baseline.teardownForDataset();
    }
  }

  writeFileSync(rawPath, rawHandle.join("\n") + "\n");
  console.error(`[bench] raw → ${rawPath}`);

  // Aggregate
  const summary = aggregate(results);
  writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  console.error(`[bench] summary → ${join(outDir, "summary.json")}`);

  const reportPath = join(outDir, "report.md");
  writeReport(reportPath, runId, results, summary);
  console.error(`[bench] report → ${reportPath}`);
  console.error(`[bench] done`);
}

function summarize(p: any): string {
  if (p.kind === "locations") return `${p.locations.length} loc`;
  if (p.kind === "deps") return `${p.imports.length}↑/${p.importers.length}↓`;
  if (p.kind === "names") return `${p.names.length} names`;
  return "";
}

export interface Summary {
  byBaseline: Record<string, BaselineAgg>;
  byCategory: Record<string, Record<string, BaselineAgg>>;
}
export interface BaselineAgg {
  n: number;
  avg_f1: number;
  avg_recall: number;
  avg_precision: number;
  avg_input_tokens: number;
  avg_tool_calls: number;
  avg_wall_ms: number;
  max_cold_start_ms: number;
  // Quality-gated stats: only runs with f1 >= 0.8
  n_passing_gate: number;
  avg_tokens_per_correct_answer: number;       // overall
  avg_tokens_per_correct_answer_gated: number; // gated
}

function aggregate(results: RunResult[]): Summary {
  const byBaseline: Record<string, BaselineAgg> = {};
  const byCategory: Record<string, Record<string, BaselineAgg>> = {};

  for (const r of results) {
    bump(byBaseline, r.baseline, r);
    if (!byCategory[r.category]) byCategory[r.category] = {};
    bump(byCategory[r.category], r.baseline, r);
  }

  finalize(byBaseline);
  for (const cat of Object.keys(byCategory)) finalize(byCategory[cat]);

  return { byBaseline, byCategory };
}

function bump(map: Record<string, BaselineAgg>, key: string, r: RunResult) {
  if (!map[key]) {
    map[key] = {
      n: 0, avg_f1: 0, avg_recall: 0, avg_precision: 0,
      avg_input_tokens: 0, avg_tool_calls: 0, avg_wall_ms: 0,
      max_cold_start_ms: 0,
      n_passing_gate: 0,
      avg_tokens_per_correct_answer: 0,
      avg_tokens_per_correct_answer_gated: 0,
    };
  }
  const a = map[key];
  a.n++;
  a.avg_f1 += r.metrics.f1;
  a.avg_recall += r.metrics.recall;
  a.avg_precision += r.metrics.precision;
  a.avg_input_tokens += r.metrics.input_tokens;
  a.avg_tool_calls += r.metrics.tool_calls;
  a.avg_wall_ms += r.metrics.wall_time_ms;
  if (r.metrics.cold_start_ms > a.max_cold_start_ms) a.max_cold_start_ms = r.metrics.cold_start_ms;
  a.avg_tokens_per_correct_answer += r.metrics.tokens_per_correct_answer;
  if (r.metrics.f1 >= 0.8) {
    a.n_passing_gate++;
    a.avg_tokens_per_correct_answer_gated += r.metrics.tokens_per_correct_answer;
  }
}

function finalize(map: Record<string, BaselineAgg>) {
  for (const k of Object.keys(map)) {
    const a = map[k];
    if (a.n > 0) {
      a.avg_f1 /= a.n;
      a.avg_recall /= a.n;
      a.avg_precision /= a.n;
      a.avg_input_tokens /= a.n;
      a.avg_tool_calls /= a.n;
      a.avg_wall_ms /= a.n;
      a.avg_tokens_per_correct_answer /= a.n;
    }
    if (a.n_passing_gate > 0) {
      a.avg_tokens_per_correct_answer_gated /= a.n_passing_gate;
    } else {
      a.avg_tokens_per_correct_answer_gated = NaN;
    }
  }
}

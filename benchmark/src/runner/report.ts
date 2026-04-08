import { writeFileSync } from "node:fs";
import type { RunResult } from "../types.ts";
import type { Summary, BaselineAgg } from "./run-primitive.ts";

const CATEGORY_LABELS: Record<string, string> = {
  P1: "Definition lookup",
  P2: "Reference finding",
  P4: "File dependencies",
  P5: "Dead code",
};

export function writeReport(path: string, runId: string, results: RunResult[], summary: Summary): void {
  const lines: string[] = [];
  lines.push(`# Sverklo Benchmark v2 — Tier A Primitives`);
  lines.push("");
  lines.push(`Run: \`${runId}\``);
  lines.push("");
  lines.push(`Tasks: ${results.length / countBaselines(summary)} unique × ${countBaselines(summary)} baselines = ${results.length} runs`);
  lines.push("");

  // ─────── 1. Headline ───────
  lines.push(`## 1. Headline`);
  lines.push("");
  const sv = summary.byBaseline["sverklo"];
  const sg = summary.byBaseline["smart-grep"];
  if (sv && sg) {
    lines.push(
      `> On **${sv.n}** verified tasks across 2 codebases, **sverklo** achieves ` +
      `F1 of **${sv.avg_f1.toFixed(2)}** with **${Math.round(sv.avg_input_tokens)}** avg input tokens ` +
      `(**${formatTpc(sv.avg_tokens_per_correct_answer_gated)}** tokens per correct answer at f1≥0.8), ` +
      `vs **smart-grep** at F1 of **${sg.avg_f1.toFixed(2)}** with **${Math.round(sg.avg_input_tokens)}** avg input tokens ` +
      `(**${formatTpc(sg.avg_tokens_per_correct_answer_gated)}** tokens per correct answer at f1≥0.8).`
    );
    lines.push("");
  }

  lines.push(`### All baselines`);
  lines.push("");
  lines.push(headlineTable(summary.byBaseline));
  lines.push("");

  // ─────── 2. Where sverklo wins ───────
  lines.push(`## 2. Where sverklo wins`);
  lines.push("");
  const wins = findWins(results);
  if (wins.length === 0) {
    lines.push(`_No clear wins on this run. This is information — investigate._`);
  } else {
    lines.push(`| Task | Category | sverklo F1 | best grep F1 | sverklo tok | best grep tok |`);
    lines.push(`|---|---|---|---|---|---|`);
    for (const w of wins.slice(0, 15)) {
      lines.push(
        `| \`${w.task}\` | ${w.category} | ${w.svF1.toFixed(2)} | ${w.grepF1.toFixed(2)} | ${w.svTok} | ${w.grepTok} |`
      );
    }
  }
  lines.push("");

  // ─────── 3. Where sverklo loses or ties ───────
  lines.push(`## 3. Where sverklo loses or ties (the honesty section)`);
  lines.push("");
  const losses = findLosses(results);
  if (losses.length === 0) {
    lines.push(`_No clear losses. Either we got lucky or the seed is too easy — both are warning signs._`);
  } else {
    lines.push(`| Task | Category | sverklo F1 | best grep F1 | sverklo tok | best grep tok | note |`);
    lines.push(`|---|---|---|---|---|---|---|`);
    for (const l of losses.slice(0, 20)) {
      lines.push(
        `| \`${l.task}\` | ${l.category} | ${l.svF1.toFixed(2)} | ${l.grepF1.toFixed(2)} | ${l.svTok} | ${l.grepTok} | ${l.note} |`
      );
    }
  }
  lines.push("");

  // ─────── 4. Per-category breakdown ───────
  lines.push(`## 4. Per-category breakdown`);
  lines.push("");
  for (const cat of ["P1", "P2", "P4", "P5"]) {
    const m = summary.byCategory[cat];
    if (!m) continue;
    lines.push(`### ${cat} — ${CATEGORY_LABELS[cat]}`);
    lines.push("");
    lines.push(headlineTable(m));
    lines.push("");
  }

  // Footer note on methodology
  lines.push(`---`);
  lines.push("");
  lines.push(`**Methodology notes**`);
  lines.push("");
  lines.push(`- _tokens_per_correct_answer_ = input_tokens / max(recall, 0.01). Lower is better.`);
  lines.push(`- The **gated** column averages only over runs where f1 >= 0.8 — we refuse to`);
  lines.push(`  reward "found nothing cheaply".`);
  lines.push(`- P1 uses ±3-line tolerance, P2 uses ±2 lines, P4/P5 use set membership.`);
  lines.push(`- naive-grep does \`grep -rn <sym> .\` then reads top 10 files in full (the floor).`);
  lines.push(`- smart-grep adds language filters, ±10-line context reads, def-shaped patterns.`);
  lines.push(`- sverklo spawns the MCP stdio server once per dataset; cold-start is the index build.`);

  writeFileSync(path, lines.join("\n") + "\n");
}

function countBaselines(s: Summary): number {
  return Object.keys(s.byBaseline).length || 1;
}

function headlineTable(map: Record<string, BaselineAgg>): string {
  const out: string[] = [];
  out.push(`| baseline | n | F1 | recall | prec | tokens | tools | wall (ms) | cold (ms) | gated tok/correct |`);
  out.push(`|---|---|---|---|---|---|---|---|---|---|`);
  for (const [name, a] of Object.entries(map)) {
    out.push(
      `| **${name}** | ${a.n} | ${a.avg_f1.toFixed(2)} | ${a.avg_recall.toFixed(2)} | ${a.avg_precision.toFixed(2)} | ${Math.round(a.avg_input_tokens)} | ${a.avg_tool_calls.toFixed(1)} | ${Math.round(a.avg_wall_ms)} | ${Math.round(a.max_cold_start_ms || 0)} | ${formatTpc(a.avg_tokens_per_correct_answer_gated)} (n=${a.n_passing_gate}) |`
    );
  }
  return out.join("\n");
}

function formatTpc(v: number): string {
  if (!isFinite(v) || isNaN(v)) return "—";
  return Math.round(v).toString();
}

interface CmpRow {
  task: string;
  category: string;
  svF1: number;
  grepF1: number;
  svTok: number;
  grepTok: number;
  note: string;
}

function findWins(results: RunResult[]): CmpRow[] {
  return compareSverkloVsBest(results)
    .filter((r) => r.svF1 > r.grepF1 + 0.05 || (r.svF1 >= r.grepF1 && r.svTok < r.grepTok / 2))
    .sort((a, b) => (b.svF1 - b.grepF1) - (a.svF1 - a.grepF1));
}

function findLosses(results: RunResult[]): CmpRow[] {
  return compareSverkloVsBest(results)
    .filter((r) => r.svF1 < r.grepF1 - 0.05 || (r.svF1 < r.grepF1 + 0.01 && r.svTok > r.grepTok))
    .sort((a, b) => (a.svF1 - a.grepF1) - (b.svF1 - b.grepF1));
}

function compareSverkloVsBest(results: RunResult[]): CmpRow[] {
  const byTask = new Map<string, RunResult[]>();
  for (const r of results) {
    const k = `${r.dataset}/${r.task_id}`;
    const arr = byTask.get(k) || [];
    arr.push(r);
    byTask.set(k, arr);
  }
  const out: CmpRow[] = [];
  for (const [k, arr] of byTask) {
    const sv = arr.find((r) => r.baseline === "sverklo");
    const grepCandidates = arr.filter((r) => r.baseline !== "sverklo");
    if (!sv || grepCandidates.length === 0) continue;
    const bestGrep = grepCandidates.reduce((a, b) => (a.metrics.f1 >= b.metrics.f1 ? a : b));
    let note = "";
    if (sv.metrics.notes) note = sv.metrics.notes.slice(0, 60);
    else if (sv.metrics.f1 === 0 && bestGrep.metrics.f1 > 0) note = "missed";
    else if (sv.metrics.f1 < bestGrep.metrics.f1) note = `vs ${bestGrep.baseline}`;
    out.push({
      task: k,
      category: sv.category,
      svF1: sv.metrics.f1,
      grepF1: bestGrep.metrics.f1,
      svTok: sv.metrics.input_tokens,
      grepTok: bestGrep.metrics.input_tokens,
      note,
    });
  }
  return out;
}

// Benchmark reproducer for `sverklo audit-diff` SC-001 claim (<200 ms
// median on sverklo's own repo for a 3–5 file diff against the working
// tree).
//
// Usage (from the sverklo repo root, with the index already built via
// `sverklo audit`):
//
//   node --experimental-strip-types --no-warnings \
//     benchmark/audit-diff/bench.ts
//
// Emits one JSON line per run plus a summary at the end. Captures the
// median, p95, and max wall-clock ms for `sverklo audit-diff` over N
// invocations on the current working tree.

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const RUNS = Number.parseInt(process.env.AUDIT_DIFF_BENCH_RUNS ?? "20", 10);
const TARGET_MS = 200;

const cwd = resolve(process.cwd());
const sverkloBin = resolve(cwd, "dist/bin/sverklo.js");

const samples: number[] = [];

for (let i = 0; i < RUNS; i++) {
  const t0 = process.hrtime.bigint();
  const r = spawnSync("node", [sverkloBin, "audit-diff", cwd], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  const t1 = process.hrtime.bigint();
  const elapsedMs = Number(t1 - t0) / 1_000_000;
  samples.push(elapsedMs);
  process.stdout.write(
    JSON.stringify({
      run: i + 1,
      elapsed_ms: Math.round(elapsedMs * 10) / 10,
      exit: r.status,
    }) + "\n",
  );
}

samples.sort((a, b) => a - b);
const median = samples[Math.floor(samples.length / 2)] ?? 0;
const p95 = samples[Math.floor(samples.length * 0.95)] ?? 0;
const max = samples[samples.length - 1] ?? 0;

const summary = {
  runs: RUNS,
  median_ms: Math.round(median * 10) / 10,
  p95_ms: Math.round(p95 * 10) / 10,
  max_ms: Math.round(max * 10) / 10,
  target_ms: TARGET_MS,
  passes_sc001: median <= TARGET_MS,
};

process.stdout.write("\n" + JSON.stringify(summary, null, 2) + "\n");

if (!summary.passes_sc001) {
  process.stderr.write(
    `\nSC-001 NOT MET: median ${summary.median_ms}ms exceeds ${TARGET_MS}ms target.\n` +
      `See specs/001-audit-diff/research.md R4 for follow-up notes.\n`,
  );
  process.exit(1);
}

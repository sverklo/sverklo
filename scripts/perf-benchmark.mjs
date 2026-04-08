#!/usr/bin/env node
// Performance benchmark for sverklo on real codebases.
//
// Usage:
//   node scripts/perf-benchmark.mjs <project-path> [project-path ...]
//
// Captures: file count, cold index time, RAM peak, DB size,
// search latency p50/p95, impact analysis time. Writes results
// to stdout as both human-readable text and a JSON line per project.
//
// Run before BENCHMARKS.md updates so the numbers in the README
// reflect real measurements on real codebases, not toy projects.

import { rmSync, statSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { Indexer } from "../dist/src/indexer/indexer.js";
import { getProjectConfig } from "../dist/src/utils/config.js";
import { handleSearch } from "../dist/src/server/tools/search.js";
import { handleImpact } from "../dist/src/server/tools/impact.js";
import { handleOverview } from "../dist/src/server/tools/overview.js";

const QUERIES = [
  "authentication flow",
  "rate limiter implementation",
  "error handling middleware",
  "websocket connection setup",
  "database connection pool",
  "JSON serialization",
  "HTTP request validation",
  "logging configuration",
  "test fixtures",
  "configuration loading",
];

function dbBytes(dbPath) {
  try {
    return statSync(dbPath).size;
  } catch {
    return 0;
  }
}

function fmtBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

function fmtMs(ms) {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function pickPivotSymbol(indexer) {
  // Find a real symbol with the most references in the symbol-ref store.
  // This is the worst-case for impact analysis (most work).
  // The column is target_name (the called/instantiated symbol), not name.
  // We pick the busiest pivot but skip generic 1-character names that are
  // almost always loop variables and would inflate the result chars.
  const stmt = indexer.db.prepare(
    `SELECT target_name, COUNT(*) as c FROM symbol_refs
     WHERE LENGTH(target_name) > 3
     GROUP BY target_name
     ORDER BY c DESC LIMIT 1`
  );
  const row = stmt.get();
  return row?.target_name || null;
}

async function benchmarkProject(rootPath) {
  console.log(`\n${"━".repeat(60)}`);
  console.log(`PROJECT: ${rootPath}`);
  console.log("━".repeat(60));

  const config = getProjectConfig(rootPath);

  // Cold start: nuke any existing index
  if (existsSync(config.dbPath)) {
    rmSync(config.dbPath, { force: true });
  }
  // Also nuke -wal and -shm sidecars
  for (const ext of ["-wal", "-shm"]) {
    const p = config.dbPath + ext;
    if (existsSync(p)) rmSync(p, { force: true });
  }

  const indexer = new Indexer(config);

  // ── Cold index timing ─────────────────────────────────────
  const memBefore = process.memoryUsage().rss;
  const t0 = performance.now();
  await indexer.index();
  const indexElapsedMs = performance.now() - t0;
  const memAfter = process.memoryUsage().rss;
  const memDeltaBytes = Math.max(0, memAfter - memBefore);

  // Force GC if available so we get a stable RSS reading
  if (global.gc) global.gc();
  const memSettled = process.memoryUsage().rss;

  const dbSizeBytes = dbBytes(config.dbPath);
  const status = indexer.getStatus();

  // ── Search latencies ──────────────────────────────────────
  // Skip the first query (warm-up) for fair p50/p95.
  const latencies = [];
  for (const q of QUERIES) {
    const ts = performance.now();
    try {
      await handleSearch(indexer, { query: q });
    } catch {}
    latencies.push(performance.now() - ts);
  }
  const searchLatencies = latencies.slice(1); // drop first (warm-up)
  searchLatencies.sort((a, b) => a - b);
  const p50 = searchLatencies[Math.floor(searchLatencies.length * 0.5)];
  const p95 = searchLatencies[Math.floor(searchLatencies.length * 0.95)];

  // ── Impact analysis on the most-referenced symbol ────────
  const pivotSymbol = pickPivotSymbol(indexer);
  let impactMs = null;
  let impactResultLen = 0;
  if (pivotSymbol) {
    const ti = performance.now();
    try {
      const result = handleImpact(indexer, { symbol: pivotSymbol });
      impactResultLen = typeof result === "string" ? result.length : 0;
    } catch {}
    impactMs = performance.now() - ti;
  }

  // ── Overview latency (PageRank-driven map) ───────────────
  const to = performance.now();
  try {
    handleOverview(indexer, {});
  } catch {}
  const overviewMs = performance.now() - to;

  indexer.close();

  // ── Report ──
  const report = {
    project: rootPath,
    files: status.fileCount,
    chunks: status.chunkCount,
    languages: status.languages,
    cold_index_ms: Math.round(indexElapsedMs),
    rss_peak_bytes: memSettled,
    rss_delta_bytes: memDeltaBytes,
    db_size_bytes: dbSizeBytes,
    search_p50_ms: p50 ? Math.round(p50 * 100) / 100 : null,
    search_p95_ms: p95 ? Math.round(p95 * 100) / 100 : null,
    overview_ms: Math.round(overviewMs * 100) / 100,
    impact_symbol: pivotSymbol,
    impact_ms: impactMs ? Math.round(impactMs * 100) / 100 : null,
    impact_result_chars: impactResultLen,
  };

  console.log(`  Files indexed:    ${report.files}`);
  console.log(`  Chunks:           ${report.chunks}`);
  console.log(`  Languages:        ${report.languages.join(", ")}`);
  console.log(`  Cold index:       ${fmtMs(report.cold_index_ms)}`);
  console.log(`  RSS peak:         ${fmtBytes(report.rss_peak_bytes)}`);
  console.log(`  DB size on disk:  ${fmtBytes(report.db_size_bytes)}`);
  console.log(`  Search p50:       ${report.search_p50_ms} ms`);
  console.log(`  Search p95:       ${report.search_p95_ms} ms`);
  console.log(`  Overview:         ${report.overview_ms} ms`);
  console.log(`  Impact pivot:     ${report.impact_symbol || "none"}`);
  console.log(`  Impact:           ${report.impact_ms} ms`);

  return report;
}

// ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node scripts/perf-benchmark.mjs <project-path> [project-path ...]");
  process.exit(1);
}

const results = [];
for (const path of args) {
  try {
    const report = await benchmarkProject(path);
    results.push(report);
  } catch (err) {
    console.error(`\n[bench] ${path} failed:`, err.message);
  }
}

console.log("\n" + "━".repeat(60));
console.log("JSON RESULTS");
console.log("━".repeat(60));
for (const r of results) console.log(JSON.stringify(r));

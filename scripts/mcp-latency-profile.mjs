#!/usr/bin/env node
// MCP roundtrip latency profiler for sverklo.
//
// Spawns the sverklo MCP server over stdio (the exact transport agents use)
// and measures end-to-end roundtrip time for representative tool calls.
// This captures the *full* cost an agent sees: JSON-RPC framing, stdio pipe
// overhead, tool dispatch, query execution, response serialization.
//
// This is separate from scripts/perf-benchmark.mjs — that one calls tool
// handlers in-process and reports pure query time. This one measures the
// wall clock a real agent would see.
//
// Usage:
//   node scripts/mcp-latency-profile.mjs [project-path] [--runs=20] [--json]
//
// Output: per-tool p50/p95/mean and a summary. With --json, prints a single
// JSON object to stdout for machine consumption.
//
// Prerequisite: `npm run build` — this script runs against dist/.

import { spawn } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const BIN = join(REPO_ROOT, "dist", "bin", "sverklo.js");

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const runsArg = args.find((a) => a.startsWith("--runs="));
const RUNS = runsArg ? parseInt(runsArg.split("=")[1], 10) : 20;
const positional = args.filter((a) => !a.startsWith("--"));
const PROJECT = resolve(positional[0] || process.cwd());

if (!existsSync(BIN)) {
  console.error(`[mcp-latency] dist binary missing at ${BIN}`);
  console.error("[mcp-latency] Run: npm run build");
  process.exit(1);
}

// ─── Minimal stdio MCP client ────────────────────────────────────────
// We speak JSON-RPC 2.0 over the server's stdin/stdout, exactly as the
// @modelcontextprotocol/sdk stdio transport does. Messages are newline-
// delimited JSON. We don't depend on the SDK here on purpose — we want to
// measure pipe + framing cost, not the SDK's own abstraction layer.

class StdioMcpClient {
  constructor(binPath, projectPath) {
    this.proc = spawn("node", [binPath, projectPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, SVERKLO_DEBUG: "" },
    });
    this.nextId = 1;
    this.pending = new Map();
    this.buf = "";
    this.proc.stdout.on("data", (chunk) => this._onData(chunk));
    this.proc.stderr.on("data", () => {}); // swallow server logs
    this.proc.on("error", (err) => {
      console.error("[mcp-latency] spawn error:", err.message);
    });
  }

  _onData(chunk) {
    this.buf += chunk.toString("utf-8");
    let newline;
    while ((newline = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, newline);
      this.buf = this.buf.slice(newline + 1);
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || "rpc error"));
        else resolve(msg.result);
      }
    }
  }

  request(method, params) {
    const id = this.nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(JSON.stringify(payload) + "\n");
      // Safety timeout so a wedged call doesn't hang the profile.
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`timeout: ${method}`));
        }
      }, 30_000);
    });
  }

  async initialize() {
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "mcp-latency-profile", version: "1.0.0" },
    });
    // Some servers require notifications/initialized before accepting calls.
    this.proc.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n"
    );
  }

  async callTool(name, args = {}) {
    return this.request("tools/call", { name, arguments: args });
  }

  close() {
    try {
      this.proc.stdin.end();
      this.proc.kill("SIGTERM");
    } catch {}
  }
}

// ─── Latency sampling ────────────────────────────────────────────────

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

function summarise(samples) {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  return {
    runs: samples.length,
    min_ms: round(sorted[0]),
    p50_ms: round(percentile(sorted, 0.5)),
    p95_ms: round(percentile(sorted, 0.95)),
    max_ms: round(sorted[sorted.length - 1]),
    mean_ms: round(mean),
  };
}

function round(n) {
  return n == null ? null : Math.round(n * 100) / 100;
}

// ─── What to measure ─────────────────────────────────────────────────
// A representative cross-section:
//   - sverklo_status: cheapest call, measures pure RPC overhead
//   - sverklo_lookup: indexed lookup, should be near-zero work
//   - sverklo_refs: graph walk, the tool that consistently earns its keep
//   - sverklo_overview: PageRank map, heavier
//   - sverklo_search: hybrid search, the tool we most need to profile
//
// If you add cases, keep them quick and idempotent — this script runs them
// dozens of times back-to-back.

const CASES = [
  { label: "sverklo_status", tool: "sverklo_status", args: {} },
  { label: "sverklo_lookup", tool: "sverklo_lookup", args: { name: "index" } },
  { label: "sverklo_overview", tool: "sverklo_overview", args: { tokenBudget: 800 } },
  { label: "sverklo_refs", tool: "sverklo_refs", args: { symbol: "index" } },
  { label: "sverklo_search", tool: "sverklo_search", args: { query: "configuration loading" } },
];

async function main() {
  const client = new StdioMcpClient(BIN, PROJECT);

  const initStart = performance.now();
  try {
    await client.initialize();
  } catch (err) {
    client.close();
    console.error("[mcp-latency] initialize failed:", err.message);
    process.exit(1);
  }
  const initMs = performance.now() - initStart;

  // First call often pays warm-up cost (index load, pragmas). Drop it.
  try {
    await client.callTool("sverklo_status", {});
  } catch {}

  const results = {};
  for (const c of CASES) {
    const samples = [];
    for (let i = 0; i < RUNS; i++) {
      const t0 = performance.now();
      try {
        await client.callTool(c.tool, c.args);
      } catch {
        // Record the attempt even on error so a broken tool shows up as
        // outliers rather than silently disappearing from the summary.
      }
      samples.push(performance.now() - t0);
    }
    results[c.label] = summarise(samples);
  }

  client.close();

  const payload = {
    project: PROJECT,
    runs_per_case: RUNS,
    initialize_ms: round(initMs),
    tools: results,
    generated_at: new Date().toISOString(),
  };

  if (jsonMode) {
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    return;
  }

  console.log("\n" + "━".repeat(64));
  console.log("SVERKLO MCP ROUNDTRIP LATENCY");
  console.log("━".repeat(64));
  console.log(`Project:  ${PROJECT}`);
  console.log(`Runs:     ${RUNS} per tool (first sample dropped as warm-up)`);
  console.log(`Init:     ${round(initMs)} ms (handshake)`);
  console.log("");
  console.log(
    "tool                       min      p50      p95      max     mean"
  );
  console.log("-".repeat(64));
  for (const [label, s] of Object.entries(results)) {
    if (!s) continue;
    console.log(
      `${label.padEnd(24)} ${String(s.min_ms).padStart(7)}  ${String(
        s.p50_ms
      ).padStart(6)}  ${String(s.p95_ms).padStart(6)}  ${String(
        s.max_ms
      ).padStart(6)}  ${String(s.mean_ms).padStart(6)}`
    );
  }
  console.log("");
  console.log("All values in milliseconds. This is end-to-end roundtrip:");
  console.log("JSON-RPC framing + stdio pipe + dispatch + handler + serialize.");
  console.log("");
}

main().catch((err) => {
  console.error("[mcp-latency] fatal:", err);
  process.exit(1);
});

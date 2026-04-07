/**
 * Sverklo Token Efficiency Benchmark
 *
 * Compares the token cost of answering code questions via:
 * 1. Raw grep + file reads (naive baseline)
 * 2. sverklo_search (hybrid semantic search)
 * 3. sverklo_impact (symbol references)
 *
 * Usage: npm run benchmark -- /path/to/target/repo
 *
 * Target repos to try:
 *   - The sverklo project itself (small)
 *   - React, Next.js, Express, etc. (medium)
 *   - Linux kernel, TypeScript (large)
 */

import { execSync } from "node:child_process";
import { join, resolve } from "node:path";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

interface BenchmarkQuery {
  name: string;
  description: string;
  // Naive grep approach — how a stateless agent would search
  grepPattern: string;
  // Semantic query for sverklo
  sverkloQuery: string;
  // Symbol for impact analysis (if applicable)
  symbolForImpact?: string;
}

const QUERIES: BenchmarkQuery[] = [
  {
    name: "auth_middleware",
    description: "How does authentication work?",
    grepPattern: "auth|jwt|token",
    sverkloQuery: "authentication middleware",
  },
  {
    name: "database_queries",
    description: "Find database query code",
    grepPattern: "query|SELECT|INSERT|prepare",
    sverkloQuery: "database query execution",
  },
  {
    name: "error_handling",
    description: "How are errors handled?",
    grepPattern: "try|catch|throw|Error",
    sverkloQuery: "error handling and recovery",
  },
  {
    name: "http_routes",
    description: "Where are HTTP routes defined?",
    grepPattern: "router|route|get\\(|post\\(",
    sverkloQuery: "HTTP route handlers",
  },
  {
    name: "state_management",
    description: "How is application state managed?",
    grepPattern: "state|store|dispatch|reducer",
    sverkloQuery: "state management and updates",
  },
];

// Rough token estimate — same heuristic as sverklo uses internally
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

interface QueryResult {
  query: string;
  grep: { tokens: number; fileCount: number; latencyMs: number };
  sverkloSearch: { tokens: number; resultCount: number; latencyMs: number };
  savings: number; // percentage
}

async function benchmarkGrep(repoPath: string, pattern: string): Promise<{ tokens: number; fileCount: number; latencyMs: number }> {
  const start = Date.now();
  let output = "";
  try {
    // Simulate what a stateless agent does: grep, then read full files.
    // Using POSIX grep so the benchmark runs anywhere without dependencies.
    const result = execSync(
      `grep -rlE '${pattern}' --include='*.ts' --include='*.tsx' --include='*.js' --include='*.py' --include='*.go' --include='*.rs' --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git . 2>/dev/null | head -10`,
      { cwd: repoPath, encoding: "utf-8", timeout: 15000, maxBuffer: 5 * 1024 * 1024, shell: "/bin/bash" }
    );
    const files = result.trim().split("\n").filter(Boolean);

    for (const f of files) {
      try {
        const content = readFileSync(join(repoPath, f), "utf-8");
        output += `=== ${f} ===\n${content}\n\n`;
      } catch {}
    }

    return {
      tokens: estimateTokens(output),
      fileCount: files.length,
      latencyMs: Date.now() - start,
    };
  } catch {
    return { tokens: 0, fileCount: 0, latencyMs: Date.now() - start };
  }
}

async function benchmarkSverkloSearch(repoPath: string, query: string): Promise<{ tokens: number; resultCount: number; latencyMs: number }> {
  // Spawn sverklo MCP server and query it
  const { spawn } = await import("node:child_process");
  const sverkloBin = resolve(join(import.meta.dirname ?? ".", "..", "dist", "bin", "sverklo.js"));

  const start = Date.now();

  return new Promise((resolvePromise) => {
    const child = spawn("node", [sverkloBin, repoPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", () => {});

    // Initialize
    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 0,
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "bench", version: "1.0" } },
      }) + "\n"
    );

    // Wait for initial indexing, then query
    setTimeout(() => {
      child.stdin.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "sverklo_search", arguments: { query, token_budget: 6000 } },
        }) + "\n"
      );
    }, 3000);

    // Collect result
    setTimeout(() => {
      const msgs = out.split("\n").filter(Boolean);
      let resultText = "";
      let resultCount = 0;
      for (const msg of msgs) {
        try {
          const p = JSON.parse(msg);
          if (p.id === 1) {
            resultText = p.result?.content?.[0]?.text || "";
            resultCount = (resultText.match(/^##/gm) || []).length;
          }
        } catch {}
      }
      child.kill();
      resolvePromise({
        tokens: estimateTokens(resultText),
        resultCount,
        latencyMs: Date.now() - start,
      });
    }, 5000);
  });
}

async function runBenchmark(repoPath: string): Promise<void> {
  const absPath = resolve(repoPath);
  console.log(`\n🔬 Sverklo Token Benchmark`);
  console.log(`   Target: ${absPath}\n`);

  // Check that grep is available (should be everywhere)
  try {
    execSync("grep --version", { stdio: "pipe" });
  } catch {
    console.error("❌ grep not found (this shouldn't happen)");
    process.exit(1);
  }

  // Count repo files first
  try {
    const count = execSync(
      `find . -type f \\( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.py' -o -name '*.go' -o -name '*.rs' \\) -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/.git/*' | wc -l`,
      { cwd: absPath, encoding: "utf-8" }
    );
    console.log(`   ${count.trim()} code files\n`);
  } catch {}

  const results: QueryResult[] = [];

  for (const q of QUERIES) {
    process.stdout.write(`  ⟳ ${q.name.padEnd(20)} `);
    const grep = await benchmarkGrep(absPath, q.grepPattern);
    const sverkloSearch = await benchmarkSverkloSearch(absPath, q.sverkloQuery);
    const savings =
      grep.tokens > 0
        ? Math.round((1 - sverkloSearch.tokens / grep.tokens) * 100)
        : 0;

    const ratio =
      sverkloSearch.tokens > 0 && grep.tokens > 0
        ? (grep.tokens / sverkloSearch.tokens).toFixed(1)
        : "N/A";

    console.log(`grep: ${grep.tokens.toString().padStart(6)} tok  |  sverklo: ${sverkloSearch.tokens.toString().padStart(5)} tok  |  ${ratio}× fewer (${savings}% savings)`);

    results.push({
      query: q.name,
      grep,
      sverkloSearch,
      savings,
    });
  }

  // Aggregate
  const totalGrep = results.reduce((a, r) => a + r.grep.tokens, 0);
  const totalSverklo = results.reduce((a, r) => a + r.sverkloSearch.tokens, 0);
  const avgRatio = totalSverklo > 0 ? (totalGrep / totalSverklo).toFixed(1) : "N/A";
  const overallSavings =
    totalGrep > 0 ? Math.round((1 - totalSverklo / totalGrep) * 100) : 0;

  console.log(`\n  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  TOTAL:                   grep: ${totalGrep.toString().padStart(6)} tok  |  sverklo: ${totalSverklo.toString().padStart(5)} tok  |  ${avgRatio}× fewer (${overallSavings}% savings)`);
  console.log("");

  // Write results to JSON
  const outDir = join(absPath, ".sverklo-bench");
  mkdirSync(outDir, { recursive: true });
  const report = {
    timestamp: new Date().toISOString(),
    target: absPath,
    queries: results,
    totals: { grep: totalGrep, sverklo: totalSverklo, ratio: avgRatio, savings: overallSavings },
  };
  const reportPath = join(outDir, "benchmark.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`  📊 Report saved to ${reportPath}\n`);
}

const target = process.argv[2] || process.cwd();
runBenchmark(target).catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});

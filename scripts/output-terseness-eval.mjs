#!/usr/bin/env node
// Honest before/after measurement of Sverklo's output terseness.
//
// Methodology: invoke handleSearch / handleContext / handleRecall on a
// curated set of representative queries against a small test repo.
// Capture the formatted Markdown output. Compute byte size, character
// count, and an approximate token count (chars / 3.7 ≈ GPT-4 tokens).
//
// This script is the reference for any "X% leaner output" claim Sverklo
// makes. Run it before/after changes to publish an honest delta.
//
// Usage: node scripts/output-terseness-eval.mjs <test-repo-path>

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const repoArg = process.argv[2] || ".";
const repoPath = resolve(repoArg);

if (!existsSync(join(repoPath, ".git")) && !existsSync(join(repoPath, "package.json"))) {
  console.error(`[error] ${repoPath} doesn't look like a project (no .git or package.json).`);
  process.exit(1);
}

// Lazy-import after path validation so a misuse error message is shown first.
const { Indexer } = await import("../dist/src/indexer/indexer.js");
const { handleSearch } = await import("../dist/src/server/tools/search.js");
const { handleContext } = await import("../dist/src/server/tools/context.js");

const QUERIES = [
  // Generic exploratory questions an agent typically asks.
  { tool: "search", args: { query: "authentication", token_budget: 4000 } },
  { tool: "search", args: { query: "error handling", token_budget: 4000 } },
  { tool: "search", args: { query: "database connection", token_budget: 4000 } },
  { tool: "search", args: { query: "configuration loading", token_budget: 4000 } },
  { tool: "search", args: { query: "logging setup", token_budget: 4000 } },
  // Context calls (heavier, includes labels + memories + neighbours).
  { tool: "context", args: { task: "add rate limiting", detail: "minimal" } },
  { tool: "context", args: { task: "understand the search pipeline", detail: "normal" } },
  { tool: "context", args: { task: "trace request flow", detail: "full" } },
  // Edge cases — the no-results path is hit often.
  { tool: "search", args: { query: "xyznonexistentterm123", token_budget: 4000 } },
  { tool: "context", args: { task: "xyznonexistentterm123", detail: "minimal" } },
];

const HANDLERS = {
  search: handleSearch,
  context: handleContext,
};

console.log(`Indexing ${repoPath}...`);
const indexer = new Indexer(repoPath);
await indexer.init();
await indexer.indexAll();

const results = [];
for (const { tool, args } of QUERIES) {
  const handler = HANDLERS[tool];
  const output = await handler(indexer, args);
  const bytes = Buffer.byteLength(output, "utf8");
  const chars = output.length;
  // Rough token estimate (GPT-4 ratio ≈ 3.7 chars/token for code-mixed text).
  const tokensApprox = Math.round(chars / 3.7);
  const label = `${tool}(${JSON.stringify(args).slice(0, 60)})`;
  results.push({ label, bytes, chars, tokensApprox, output_preview: output.slice(0, 200) });
  console.log(`  ${label}: ${bytes}B / ~${tokensApprox} tok`);
}

const totalBytes = results.reduce((s, r) => s + r.bytes, 0);
const totalTokens = results.reduce((s, r) => s + r.tokensApprox, 0);
const summary = {
  generated_at: new Date().toISOString(),
  sverklo_version: JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version,
  repo: repoPath,
  query_count: results.length,
  total_bytes: totalBytes,
  total_tokens_approx: totalTokens,
  avg_bytes_per_query: Math.round(totalBytes / results.length),
  avg_tokens_per_query: Math.round(totalTokens / results.length),
  results,
};

const outPath = process.env.SVERKLO_EVAL_OUT || "scripts/output-terseness-eval.json";
writeFileSync(outPath, JSON.stringify(summary, null, 2));
console.log(`\n${results.length} queries · ${totalBytes}B total · ~${totalTokens} tokens`);
console.log(`Avg per query: ${summary.avg_bytes_per_query}B / ~${summary.avg_tokens_per_query} tok`);
console.log(`\nWrote ${outPath}`);

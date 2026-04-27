// Diagnostic for the v0.18 upstream channel — runs against a cached
// bench:swe checkout and reports PageRank distribution + what the
// upstream channel would surface for one specific failing question.

import { resolve } from "node:path";
import { Indexer } from "../dist/src/indexer/indexer.js";
import { getProjectConfig } from "../dist/src/utils/config.js";
import { runInvestigate } from "../dist/src/search/investigate.js";

const repoRoot = process.argv[2] ?? resolve(process.cwd(), "benchmark/.cache/swe/express-v5.0.1");
const query = process.argv[3] ?? "How does Express dispatch a request to the right route handler when multiple routers are mounted on overlapping paths?";

console.log(`[debug] repo=${repoRoot}`);
console.log(`[debug] query=${query.slice(0, 80)}...`);

const config = getProjectConfig(repoRoot);
const indexer = new Indexer(config);
await indexer.index();

// 1. PageRank distribution
const allFiles = indexer.fileStore.getAll();
console.log(`\n[debug] indexed files: ${allFiles.length}`);
const ranks = allFiles.map((f) => f.pagerank).filter((r) => r > 0).sort((a, b) => b - a);
console.log(`[debug] non-zero pagerank files: ${ranks.length}`);
if (ranks.length > 0) {
  console.log(`[debug] pagerank max: ${ranks[0].toFixed(4)}, median: ${ranks[Math.floor(ranks.length / 2)].toFixed(4)}, min: ${ranks[ranks.length - 1].toFixed(4)}`);
  const decileIdx = Math.max(0, Math.floor(ranks.length * 0.1) - 1);
  console.log(`[debug] top-decile threshold (idx ${decileIdx} of ${ranks.length}): ${ranks[decileIdx].toFixed(4)}`);
}

// 2. Top-PageRank files
console.log(`\n[debug] top 10 PageRank files:`);
for (const f of allFiles.sort((a, b) => b.pagerank - a.pagerank).slice(0, 10)) {
  console.log(`  ${f.pagerank.toFixed(4)}  ${f.path}`);
}

// 3. Look at lib/router/index.js specifically
const routerIndex = allFiles.find((f) => f.path.endsWith("lib/router/index.js"));
const routeJs = allFiles.find((f) => f.path.endsWith("lib/router/route.js"));
const layerJs = allFiles.find((f) => f.path.endsWith("lib/router/layer.js"));
console.log(`\n[debug] target files:`);
for (const f of [routerIndex, routeJs, layerJs]) {
  if (!f) continue;
  console.log(`  pagerank=${f.pagerank.toFixed(4)}  ${f.path}`);
}

// 4. getImporters for each — what does the upstream walk see?
for (const f of [routerIndex, routeJs, layerJs]) {
  if (!f) continue;
  const importers = indexer.graphStore.getImporters(f.id);
  console.log(`\n[debug] importers of ${f.path}:`);
  for (const imp of importers.slice(0, 8)) {
    const src = allFiles.find((x) => x.id === imp.source_file_id);
    if (src) console.log(`  pr=${src.pagerank.toFixed(4)}  ${src.path}  (refs=${imp.reference_count})`);
  }
}

// 5. Run investigate WITHOUT and WITH expandUpstream, compare top-20 file paths
const withoutFlag = await runInvestigate(indexer, { query, budget: 50 });
const withFlag = await runInvestigate(indexer, { query, budget: 50, expandUpstream: true });

const topFiles = (r) => {
  const seen = new Set();
  const out = [];
  for (const h of r.hits) {
    if (seen.has(h.file.path)) continue;
    seen.add(h.file.path);
    out.push(h.file.path);
    if (out.length >= 20) break;
  }
  return out;
};

console.log(`\n[debug] top 20 files WITHOUT --expand-upstream:`);
for (const p of topFiles(withoutFlag)) console.log(`  ${p}`);
console.log(`\n[debug] top 20 files WITH --expand-upstream:`);
for (const p of topFiles(withFlag)) console.log(`  ${p}`);

console.log(`\n[debug] budget_used WITHOUT:`, withoutFlag.budget_used);
console.log(`[debug] budget_used WITH:   `, withFlag.budget_used);

#!/usr/bin/env node
// Generate snapshot data for sverklo-site/playground/snapshots.json.
//
// Phase C of the web playground (issue #10): pre-computed JSON
// responses for a fixed set of canned queries on three demo repos.
// Ship the snapshots as a static asset under sverklo-site and let
// the static page hydrate from them. No server, no WASM — just
// "see it work" before installing.
//
// Usage:
//   node scripts/generate-playground-data.mjs [--out=<path>]
//
// Requires the reproducible bench cache to already exist (run
// `npm run bench` once first). If it doesn't, this script will
// prompt to clone the demo repos.

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

import { Indexer } from "../dist/src/indexer/indexer.js";
import { getProjectConfig } from "../dist/src/utils/config.js";
import { handleSearch } from "../dist/src/server/tools/search.js";
import { handleOverview } from "../dist/src/server/tools/overview.js";
import { handleLookup } from "../dist/src/server/tools/lookup.js";
import { handleFindReferences } from "../dist/src/server/tools/find-references.js";
import { handleAudit } from "../dist/src/server/tools/audit.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SITE_ROOT = resolve(REPO_ROOT, "..", "sverklo-site");
const DEFAULT_OUT = join(SITE_ROOT, "playground", "snapshots.json");
const CACHE_DIR = join(homedir(), ".sverklo-bench-cache");

const args = process.argv.slice(2);
const outArg = args.find((a) => a.startsWith("--out="));
const OUT = outArg ? resolve(outArg.split("=")[1]) : DEFAULT_OUT;

// Canonical demo repo set. Same pinned refs as scripts/bench-reproducer.mjs
// so the playground matches the benchmarks readers see in the README.
const DEMO_REPOS = [
  {
    label: "gin",
    displayName: "gin-gonic/gin",
    ref: "v1.10.0",
    url: "https://github.com/gin-gonic/gin.git",
  },
  {
    label: "nestjs",
    displayName: "nestjs/nest",
    ref: "v10.4.0",
    url: "https://github.com/nestjs/nest.git",
  },
  {
    label: "react",
    displayName: "facebook/react",
    ref: "v18.3.1",
    url: "https://github.com/facebook/react.git",
  },
];

// Canned query plan. Each entry is a single tool call with args we
// think will return interesting output. The `label` is what the
// sidebar shows; the `query` is what a curious reader would type.
//
// Design rules:
//   - Every tool sverklo ships gets at least one example.
//   - Prefer queries that exercise PageRank or the symbol graph, not
//     just FTS — those are what sverklo is actually good at.
//   - Keep the label under ~45 chars so the sidebar stays scannable.
const QUERY_PLAN = [
  {
    label: "Top-ranked files (overview)",
    query: "Show the top structurally important files",
    tool: "sverklo_overview",
    handler: async (ix) => handleOverview(ix, { tokenBudget: 1200 }),
  },
  {
    label: "Search: error handling",
    query: "how is error handling done",
    tool: "sverklo_search",
    handler: async (ix) =>
      handleSearch(ix, { query: "error handling middleware panic recovery", token_budget: 1500 }),
  },
  {
    label: "Search: request routing",
    query: "how does request routing work",
    tool: "sverklo_search",
    handler: async (ix) =>
      handleSearch(ix, { query: "request routing dispatch handler", token_budget: 1500 }),
  },
  {
    label: "Audit: god classes and hubs",
    query: "surface the god classes and hub files",
    tool: "sverklo_audit",
    handler: async (ix) => handleAudit(ix, {}),
  },
];

// Repo-specific deep lookups. We pick a symbol that we know exists
// in each repo so the lookup output is meaningful. If the symbol
// isn't found, the generator still emits the snapshot with whatever
// sverklo returns — that's honest output.
const PER_REPO_LOOKUPS = {
  gin: [
    {
      label: "Lookup: Context",
      query: "Find the Context struct",
      tool: "sverklo_lookup",
      handler: async (ix) => handleLookup(ix, { symbol: "Context", token_budget: 800 }),
    },
    {
      label: "Refs: HandlerFunc",
      query: "Who uses HandlerFunc?",
      tool: "sverklo_refs",
      handler: async (ix) => handleFindReferences(ix, { symbol: "HandlerFunc" }),
    },
  ],
  nestjs: [
    {
      label: "Lookup: Module",
      query: "Find the Module decorator",
      tool: "sverklo_lookup",
      handler: async (ix) => handleLookup(ix, { symbol: "Module", token_budget: 800 }),
    },
    {
      label: "Refs: Injectable",
      query: "Who uses Injectable?",
      tool: "sverklo_refs",
      handler: async (ix) => handleFindReferences(ix, { symbol: "Injectable" }),
    },
  ],
  react: [
    {
      label: "Lookup: useState",
      query: "Find the useState hook",
      tool: "sverklo_lookup",
      handler: async (ix) => handleLookup(ix, { symbol: "useState", token_budget: 800 }),
    },
    {
      label: "Refs: ReactElement",
      query: "Who uses ReactElement?",
      tool: "sverklo_refs",
      handler: async (ix) => handleFindReferences(ix, { symbol: "ReactElement" }),
    },
  ],
};

function getSverkloVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8"));
    return `v${pkg.version}`;
  } catch {
    return "unknown";
  }
}

function ensureRepo(repo) {
  const target = join(CACHE_DIR, repo.label);
  if (!existsSync(target)) {
    mkdirSync(CACHE_DIR, { recursive: true });
    console.log(`[playground] cloning ${repo.url}@${repo.ref}`);
    execSync(`git clone --depth 1 --branch ${repo.ref} ${repo.url} ${target}`, {
      stdio: "inherit",
    });
  }
  return target;
}

async function runPlanForRepo(repo, indexer) {
  const captured = new Date().toISOString();
  const version = getSverkloVersion();
  const out = [];

  const allQueries = [...QUERY_PLAN, ...(PER_REPO_LOOKUPS[repo.label] || [])];

  for (const entry of allQueries) {
    try {
      console.log(`[playground] ${repo.label} · ${entry.label}`);
      const output = await entry.handler(indexer);
      out.push({
        repo: repo.displayName,
        label: entry.label,
        query: entry.query,
        tool: entry.tool,
        output: typeof output === "string" ? output : JSON.stringify(output, null, 2),
        captured_at: captured,
        version,
      });
    } catch (err) {
      console.error(`[playground] ${repo.label} · ${entry.label} failed:`, err.message);
      out.push({
        repo: repo.displayName,
        label: entry.label,
        query: entry.query,
        tool: entry.tool,
        output: `[error running this query: ${err.message}]`,
        captured_at: captured,
        version,
      });
    }
  }

  return out;
}

async function main() {
  console.log("[playground] generating snapshot data for", OUT);

  const allSnapshots = [];

  for (const repo of DEMO_REPOS) {
    const path = ensureRepo(repo);
    console.log(`[playground] indexing ${repo.label} at ${path}`);
    const cfg = getProjectConfig(path);
    const indexer = new Indexer(cfg);
    try {
      await indexer.index();
      const snapshots = await runPlanForRepo(repo, indexer);
      allSnapshots.push(...snapshots);
    } finally {
      indexer.close();
    }
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(allSnapshots, null, 2) + "\n", "utf-8");

  console.log("");
  console.log(`[playground] wrote ${allSnapshots.length} snapshots to ${OUT}`);
  console.log("[playground] deploy sverklo-site to publish:");
  console.log("  cd ../sverklo-site && netlify deploy --prod");
}

main().catch((e) => {
  console.error("[playground] fatal:", e);
  process.exit(1);
});

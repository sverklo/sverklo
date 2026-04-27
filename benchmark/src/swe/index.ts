// bench:swe — cross-repo recall evaluation.
//
// Runs the same investigate pipeline used by `bench:research`, but against a
// pinned set of public OSS repos, with one JSONL of grounded questions per
// repo. Repos are cloned to `benchmark/.cache/swe/<name>-<ref>` (gitignored)
// and reused across runs.
//
// The point: bench:research grades sverklo on its own codebase, with synonyms
// the team can tune to pass it. This eval scores us on code we did NOT
// write, against questions whose ground truth is "files a real PR touched
// when fixing this bug" or "the canonical implementation file." Anyone can
// reproduce it; anyone can extend it. PRs that add questions are welcome.
//
// Usage:
//   npm run build
//   npm run bench:swe
//   npm run bench:swe -- --max 8                    # quick smoke
//   npm run bench:swe -- --only express,vite        # subset by repo
//   npm run bench:swe -- --skip-clone               # use pre-checked-out cache

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runResearchBench, formatReport } from "../research/runner.ts";
import type { ResearchRunSummary } from "../research/types.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "../../..");
const CACHE_DIR = resolve(ROOT, "benchmark/.cache/swe");
const DATASETS_DIR = resolve(__dirname, "datasets");
const REPOS_FILE = resolve(__dirname, "repos.json");

interface RepoEntry {
  name: string;
  url: string;
  ref: string;
  dataset: string;
}

interface CrossRepoResult {
  repo: string;
  ref: string;
  summary: ResearchRunSummary | null;
  error?: string;
}

const args = process.argv.slice(2);
const flagVal = (name: string): string | undefined => {
  const idx = args.indexOf(name);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  const prefixed = args.find((a) => a.startsWith(`${name}=`));
  return prefixed ? prefixed.slice(name.length + 1) : undefined;
};

const onlyRaw = flagVal("--only");
const onlyRepos = onlyRaw ? new Set(onlyRaw.split(",").map((s) => s.trim())) : null;
const skipClone = args.includes("--skip-clone");
const maxStr = flagVal("--max");
const maxTasks = maxStr ? Number(maxStr) : undefined;
const expandGraph = args.includes("--expand-graph");
const expandUpstream = args.includes("--expand-upstream");

const repos = JSON.parse(readFileSync(REPOS_FILE, "utf-8")) as RepoEntry[];
const targets = onlyRepos ? repos.filter((r) => onlyRepos.has(r.name)) : repos;

if (targets.length === 0) {
  console.error(`No matching repos for --only=${onlyRaw}. Known: ${repos.map((r) => r.name).join(", ")}`);
  process.exit(2);
}

mkdirSync(CACHE_DIR, { recursive: true });

console.log(
  `[bench:swe] running ${targets.length} repo${targets.length === 1 ? "" : "s"} ` +
  `(${targets.map((r) => r.name).join(", ")})${maxTasks ? ` max=${maxTasks}` : ""}` +
  `${expandGraph ? " (expand_graph=on)" : ""}${expandUpstream ? " (expand_upstream=on)" : ""}`
);

const results: CrossRepoResult[] = [];

for (const repo of targets) {
  const checkoutDir = resolve(CACHE_DIR, `${repo.name}-${repo.ref.replace(/[^A-Za-z0-9._-]/g, "_")}`);
  const datasetPath = resolve(DATASETS_DIR, repo.dataset);

  if (!existsSync(datasetPath)) {
    results.push({ repo: repo.name, ref: repo.ref, summary: null, error: `dataset missing: ${datasetPath}` });
    continue;
  }

  if (!skipClone && !existsSync(checkoutDir)) {
    console.log(`  cloning ${repo.url} @ ${repo.ref} → ${checkoutDir}`);
    const clone = spawnSync(
      "git",
      ["clone", "--depth", "1", "--branch", repo.ref, repo.url, checkoutDir],
      { stdio: "inherit" }
    );
    if (clone.status !== 0) {
      results.push({ repo: repo.name, ref: repo.ref, summary: null, error: `clone failed (status ${clone.status})` });
      continue;
    }
  } else if (!existsSync(checkoutDir)) {
    results.push({ repo: repo.name, ref: repo.ref, summary: null, error: `--skip-clone but ${checkoutDir} not present` });
    continue;
  }

  console.log(`\n[bench:swe] ${repo.name}@${repo.ref}`);
  try {
    const summary = await runResearchBench({
      repoRoot: checkoutDir,
      datasetPath,
      maxTasks,
      expandGraph,
      expandUpstream,
    });
    results.push({ repo: repo.name, ref: repo.ref, summary });
    console.log(formatReport(summary));
  } catch (err) {
    const e = err as { message?: string };
    results.push({ repo: repo.name, ref: repo.ref, summary: null, error: e.message ?? String(err) });
  }
}

// ── Cross-repo aggregate ─────────────────────────────────────────────────
const aggregate = computeAggregate(results);
console.log("\n");
console.log("# bench:swe — cross-repo aggregate");
console.log("");
console.log(`**repos:** ${aggregate.reposEvaluated}/${targets.length}`);
console.log(`**total tasks:** ${aggregate.totalTasks}`);
console.log(`**avg recall:** ${(aggregate.weightedRecall * 100).toFixed(1)}%`);
console.log(`**perfect recall:** ${aggregate.perfectRecall}/${aggregate.totalTasks}`);
console.log("");
console.log("| Repo | Tasks | Avg recall | Perfect |");
console.log("|---|---|---|---|");
for (const r of results) {
  if (!r.summary) {
    console.log(`| ${r.repo} | — | — | (${r.error}) |`);
    continue;
  }
  const s = r.summary;
  console.log(
    `| ${r.repo} | ${s.total_tasks} | ${(s.avg_recall * 100).toFixed(1)}% | ${s.perfect_recall}/${s.total_tasks} |`
  );
}

// Failure summary — never silent.
const failed = results.filter((r) => !r.summary);
if (failed.length > 0) {
  console.log("\n## Failures");
  for (const f of failed) console.log(`- ${f.repo}@${f.ref}: ${f.error}`);
}

interface Aggregate {
  reposEvaluated: number;
  totalTasks: number;
  weightedRecall: number;
  perfectRecall: number;
}

function computeAggregate(rs: CrossRepoResult[]): Aggregate {
  let totalTasks = 0;
  let recallSum = 0;
  let perfect = 0;
  let evaluated = 0;
  for (const r of rs) {
    if (!r.summary) continue;
    evaluated++;
    totalTasks += r.summary.total_tasks;
    recallSum += r.summary.avg_recall * r.summary.total_tasks;
    perfect += r.summary.perfect_recall;
  }
  return {
    reposEvaluated: evaluated,
    totalTasks,
    weightedRecall: totalTasks === 0 ? 0 : recallSum / totalTasks,
    perfectRecall: perfect,
  };
}

process.exit(failed.length > 0 ? 1 : 0);

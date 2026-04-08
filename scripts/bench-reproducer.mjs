#!/usr/bin/env node
// Reproducible benchmark runner for sverklo.
//
// Clones three canonical real-world repos (small / medium / large), runs
// perf-benchmark.mjs against each, and writes results to stdout as human-
// readable text + one JSON line per repo.
//
// Inspired by ripgrep's benchsuite — every number in BENCHMARKS.md should
// be re-runnable with a single command. If you can't reproduce the numbers,
// you shouldn't trust them.
//
// Usage:
//   node scripts/bench-reproducer.mjs [--json] [--no-cleanup] [--cache-dir=PATH]
//
// By default, repos are cloned into ~/.sverklo-bench-cache and reused across
// runs. Pass --no-cleanup never (it's already not cleaning up) — pass nothing
// and we keep the clones. Pass --fresh to re-clone.

import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const freshClone = args.includes("--fresh");
const cacheArg = args.find((a) => a.startsWith("--cache-dir="));
const CACHE_DIR = cacheArg
  ? resolve(cacheArg.split("=")[1])
  : join(homedir(), ".sverklo-bench-cache");

// The canonical benchmark set. Keep this list small and public so anyone
// can re-run. Each repo is pinned to a specific commit so results are
// comparable across runs even as upstream moves on.
//
// Rules for additions:
//   - Must be MIT/Apache/BSD/ISC licensed so cloning is unambiguous.
//   - Must be popular enough that numbers are interesting to third parties.
//   - Must span a size range — we want small / medium / large at minimum.
//   - Pinned commits only. Never a moving ref like main.
const BENCH_REPOS = [
  {
    label: "gin",
    url: "https://github.com/gin-gonic/gin.git",
    ref: "v1.10.0",
    size: "small",
    notes: "~99 Go files. Small, tight, representative of a mature library.",
  },
  {
    label: "nestjs",
    url: "https://github.com/nestjs/nest.git",
    ref: "v10.4.0",
    size: "medium",
    notes: "~1,700 TS files. Medium-size TypeScript framework with a dense symbol graph.",
  },
  {
    label: "react",
    url: "https://github.com/facebook/react.git",
    ref: "v18.3.1",
    size: "large",
    notes: "~4,400 JS files. Large, PageRank-heavy, worst-case for cold indexing.",
  },
];

function log(...parts) {
  if (!jsonMode) console.log(...parts);
}

function err(...parts) {
  console.error(...parts);
}

function run(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, stdio: jsonMode ? "pipe" : "inherit", encoding: "utf8" });
  } catch (e) {
    err(`[bench] command failed: ${cmd}`);
    err(e.message || e);
    throw e;
  }
}

function ensureCloned(repo) {
  const target = join(CACHE_DIR, repo.label);
  if (freshClone && existsSync(target)) {
    log(`[bench] --fresh set, removing ${target}`);
    rmSync(target, { recursive: true, force: true });
  }

  if (!existsSync(target)) {
    mkdirSync(CACHE_DIR, { recursive: true });
    log(`[bench] cloning ${repo.url} @ ${repo.ref} -> ${target}`);
    // Shallow clone to the exact tag to minimize bandwidth. We don't
    // rely on history beyond the pinned commit.
    run(`git clone --depth 1 --branch ${repo.ref} ${repo.url} ${target}`);
  } else {
    log(`[bench] reusing cached clone at ${target}`);
    // Verify we're still on the pinned ref. If not, warn loudly so the
    // user knows the numbers aren't comparable. We don't auto-fix because
    // that can silently discard work if someone's been hacking on the cache.
    try {
      const head = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: target,
        encoding: "utf8",
      }).trim();
      const expected = repo.ref.startsWith("v") ? `HEAD` : repo.ref;
      if (head !== expected && head !== "HEAD") {
        err(
          `[bench] WARNING: ${target} is on '${head}', expected pinned ref '${repo.ref}'. ` +
            `Numbers may not match published benchmarks. Pass --fresh to re-clone.`
        );
      }
    } catch {
      // Not a git repo anymore, or something broken — just warn.
      err(`[bench] WARNING: ${target} is not a clean git checkout. Pass --fresh to re-clone.`);
    }
  }
  return target;
}

async function main() {
  log("━".repeat(64));
  log("SVERKLO REPRODUCIBLE BENCHMARK");
  log("━".repeat(64));
  log(`Cache directory: ${CACHE_DIR}`);
  log(`Repos:           ${BENCH_REPOS.map((r) => `${r.label}@${r.ref}`).join(", ")}`);
  log("");

  // Make sure the build is current. Perf benchmark script loads from dist/.
  const distBench = join(REPO_ROOT, "scripts", "perf-benchmark.mjs");
  if (!existsSync(distBench)) {
    err(`[bench] perf-benchmark.mjs not found at ${distBench}`);
    process.exit(1);
  }
  if (!existsSync(join(REPO_ROOT, "dist", "src", "indexer", "indexer.js"))) {
    log("[bench] dist missing — running npm run build");
    run("npm run build", REPO_ROOT);
  }

  // Clone or refresh all repos first so a later clone failure doesn't
  // leave us with a half-finished report.
  const targets = [];
  for (const repo of BENCH_REPOS) {
    try {
      const target = ensureCloned(repo);
      targets.push({ repo, target });
    } catch {
      err(`[bench] skipping ${repo.label} (clone failed)`);
    }
  }

  if (targets.length === 0) {
    err("[bench] no repos could be cloned. check your network and try again.");
    process.exit(1);
  }

  // Run the perf benchmark on each target. We shell out to the existing
  // perf-benchmark.mjs rather than importing it so each run gets a fresh
  // process and can't contaminate the next one's RSS measurement.
  const results = [];
  for (const { repo, target } of targets) {
    log("");
    log(`━ ${repo.label} (${repo.size}) ${"━".repeat(60 - repo.label.length - repo.size.length)}`);
    log(`  ${repo.notes}`);
    log("");

    const child = spawnSync(
      "node",
      [join("scripts", "perf-benchmark.mjs"), target],
      { cwd: REPO_ROOT, encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] }
    );

    if (child.status !== 0) {
      err(`[bench] ${repo.label} perf benchmark failed with code ${child.status}`);
      continue;
    }

    // perf-benchmark.mjs prints human output and then one JSON line per
    // project. We extract the last JSON-looking line.
    const stdout = child.stdout || "";
    if (!jsonMode) process.stdout.write(stdout);
    const jsonLines = stdout
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("{") && l.endsWith("}"));
    const last = jsonLines[jsonLines.length - 1];
    if (last) {
      try {
        const parsed = JSON.parse(last);
        results.push({
          label: repo.label,
          ref: repo.ref,
          size: repo.size,
          ...parsed,
        });
      } catch {
        err(`[bench] could not parse result JSON for ${repo.label}`);
      }
    }
  }

  // Final report
  log("");
  log("━".repeat(64));
  log("SUMMARY");
  log("━".repeat(64));
  log("");
  log(
    "repo        files  chunks  cold index  db size  search p50  search p95"
  );
  log("-".repeat(64));
  for (const r of results) {
    const files = String(r.files ?? "—").padStart(6);
    const chunks = String(r.chunks ?? "—").padStart(7);
    const cold =
      r.cold_index_ms != null
        ? `${(r.cold_index_ms / 1000).toFixed(1)} s`.padStart(10)
        : "—".padStart(10);
    const dbSize =
      r.db_size_bytes != null
        ? `${(r.db_size_bytes / 1024 / 1024).toFixed(1)} MB`.padStart(8)
        : "—".padStart(8);
    const p50 = `${r.search_p50_ms ?? "—"} ms`.padStart(11);
    const p95 = `${r.search_p95_ms ?? "—"} ms`.padStart(11);
    log(`${r.label.padEnd(10)}${files} ${chunks} ${cold} ${dbSize} ${p50} ${p95}`);
  }
  log("");
  log("All numbers are reproducible. Re-run with: npm run bench");
  log("");

  if (jsonMode) {
    process.stdout.write(
      JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          cache_dir: CACHE_DIR,
          repos: BENCH_REPOS,
          results,
        },
        null,
        2
      ) + "\n"
    );
  }
}

main().catch((e) => {
  err("[bench] fatal:", e);
  process.exit(1);
});

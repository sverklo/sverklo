import { existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve as resolvePath } from "node:path";
import type { GraphReader, FilePathResolver } from "./boundary.js";
import {
  applyDiffEdits,
  buildPreBoundary,
} from "./boundary.js";
import { classifyCycles, tarjanSCC } from "./cycle.js";
import { detectFanInSpikes, parseThreshold } from "./fan-in.js";
import {
  analyzableEntries,
  GitDiffError,
  runGitDiff,
} from "./diff-parser.js";
import { emptyReport, toHuman, toJSON } from "./reporter.js";
import {
  DEFAULT_FAN_IN_THRESHOLD,
  EXIT_CONFIG_ERROR,
  EXIT_GATE_FAIL,
  EXIT_PASS,
} from "./types.js";
import type {
  AuditDiffOptions,
  AuditReport,
} from "./types.js";

// Entry point invoked by bin/sverklo.ts. Returns an exit code; the caller
// passes it to process.exit. No process.exit inside this module — keeps
// it testable.

interface ParsedFlags {
  options: AuditDiffOptions | null;
  error: string | null;
}

export function parseFlags(
  args: string[],
  defaultProjectPath: string,
): ParsedFlags {
  let baseRef = "HEAD";
  let fanInThreshold = DEFAULT_FAN_IN_THRESHOLD;
  let format: "human" | "json" = "human";
  let showExisting = false;
  let verbose = false;
  let projectPath = defaultProjectPath;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case "--against":
        if (!args[i + 1]) return { options: null, error: "--against requires a value" };
        baseRef = args[i + 1]!;
        i++;
        break;
      case "--fan-in-threshold": {
        if (!args[i + 1]) return { options: null, error: "--fan-in-threshold requires a value" };
        const t = parseThreshold(args[i + 1]!);
        if (t === null) return { options: null, error: `invalid --fan-in-threshold: ${args[i + 1]}` };
        fanInThreshold = t;
        i++;
        break;
      }
      case "--format": {
        if (!args[i + 1]) return { options: null, error: "--format requires a value" };
        const fmt = args[i + 1]!;
        if (fmt !== "human" && fmt !== "json") {
          return { options: null, error: `invalid --format: ${fmt}` };
        }
        format = fmt;
        i++;
        break;
      }
      case "--show-existing":
        showExisting = true;
        break;
      case "--verbose":
        verbose = true;
        break;
      case "--help":
      case "-h":
        // Help is handled upstream; we shouldn't see it here, but if we do
        // treat it as a no-op success.
        return { options: null, error: "--help handled upstream" };
      default:
        if (a && a.startsWith("--")) {
          return { options: null, error: `unknown flag: ${a}` };
        }
        if (a) {
          projectPath = resolvePath(a);
        }
    }
  }

  return {
    options: {
      baseRef,
      fanInThreshold,
      format,
      showExisting,
      verbose,
      projectPath,
    },
    error: null,
  };
}

interface RunDependencies {
  graph: GraphReader;
  resolver: FilePathResolver;
  dbPath: string;
}

export interface HandleAuditDiffIO {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

const defaultIO: HandleAuditDiffIO = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

// Detect a stale index — if the .sverklo DB mtime predates the most
// recent commit affecting any indexed file. Warning-only (FR-014).
export function detectStaleIndex(dbPath: string, cwd: string): string | null {
  if (!existsSync(dbPath)) return null;
  const dbStat = statSync(dbPath);
  const dbMtimeSec = Math.floor(dbStat.mtimeMs / 1000);
  const r = spawnSync("git", ["log", "-1", "--format=%ct", "HEAD"], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  if (r.status !== 0) return null;
  const headTs = parseInt(r.stdout.trim(), 10);
  if (!Number.isFinite(headTs)) return null;
  if (dbMtimeSec < headTs) {
    const minutes = Math.round((headTs - dbMtimeSec) / 60);
    return `sverklo audit-diff: index is ${minutes} minutes older than HEAD; results may be incomplete`;
  }
  return null;
}

// Run the full audit-diff pipeline against pre-resolved dependencies.
// Pure function for testability — no process state, no DB opening, no
// process.exit. Returns the report + exit code.
export function runAuditDiff(
  options: AuditDiffOptions,
  deps: RunDependencies,
): { report: AuditReport; exitCode: number; warning: string | null } {
  const t0 = Date.now();

  // Stale-index detection runs first because it influences the warning
  // surfaced to the user even on a pass.
  const warning = detectStaleIndex(deps.dbPath, options.projectPath);

  let diffSet;
  try {
    diffSet = runGitDiff({
      baseRef: options.baseRef,
      cwd: options.projectPath,
    });
  } catch (e) {
    const msg = e instanceof GitDiffError ? e.message : String(e);
    const report = emptyReport(options.baseRef);
    report.warnings.push(`git diff failed: ${msg}`);
    return { report, exitCode: EXIT_CONFIG_ERROR, warning };
  }

  const analyzable = analyzableEntries(diffSet);
  if (analyzable.length === 0) {
    const report = emptyReport(options.baseRef);
    report.diff.modified_paths = diffSet.entries.map((e) => e.path);
    report.diff.analyzable_paths = [];
    report.stats.elapsed_ms = Date.now() - t0;
    if (warning) report.warnings.push(warning);
    return { report, exitCode: EXIT_PASS, warning };
  }

  const seedIds = analyzable
    .map((e) => deps.resolver.pathToId(e.path))
    .filter((id): id is number => id !== null);

  if (seedIds.length === 0) {
    const report = emptyReport(options.baseRef);
    report.diff.modified_paths = analyzable.map((e) => e.path);
    report.diff.analyzable_paths = analyzable.map((e) => e.path);
    report.warnings.push(
      "no diff files are indexed yet — run `sverklo audit` to refresh the index",
    );
    report.stats.elapsed_ms = Date.now() - t0;
    if (warning) report.warnings.push(warning);
    return { report, exitCode: EXIT_PASS, warning };
  }

  const pre = buildPreBoundary({
    graph: deps.graph,
    resolver: deps.resolver,
    seeds: seedIds,
  });

  const post = applyDiffEdits({
    pre: pre.graph,
    lookup: pre.lookup,
    resolver: deps.resolver,
    diffEntries: analyzable,
    projectRoot: options.projectPath,
    baseRef: options.baseRef,
  });

  const preSCCs = tarjanSCC(pre.graph);
  const postSCCs = tarjanSCC(post);
  const cycleViolations = classifyCycles(preSCCs, postSCCs, pre.lookup);
  const fanInViolations = detectFanInSpikes(
    pre.graph,
    post,
    options.fanInThreshold,
    pre.lookup,
  );

  const all = [...cycleViolations, ...fanInViolations];
  const newOnes = all.filter((v) => v.newInThisDiff);
  const preExisting = all.filter((v) => !v.newInThisDiff);

  let edgeCount = 0;
  for (const targets of post.edges.values()) edgeCount += targets.size;

  const report: AuditReport = {
    schema_version: "1",
    pass: newOnes.length === 0,
    diff: {
      base_ref: options.baseRef,
      modified_paths: diffSet.entries.map((e) => e.path),
      analyzable_paths: analyzable.map((e) => e.path),
    },
    violations: newOnes,
    pre_existing: options.showExisting ? preExisting : [],
    stats: {
      boundary_node_count: post.nodes.size,
      boundary_edge_count: edgeCount,
      elapsed_ms: Date.now() - t0,
    },
    warnings: warning ? [warning] : [],
  };

  const exitCode = report.pass ? EXIT_PASS : EXIT_GATE_FAIL;
  return { report, exitCode, warning };
}

// Public CLI handler — opens the database, builds deps, runs the
// pipeline, prints output, returns an exit code.
export async function handleAuditDiff(
  args: string[],
  io: HandleAuditDiffIO = defaultIO,
): Promise<number> {
  const cwd = process.cwd();
  const parsed = parseFlags(args, cwd);
  if (parsed.error || !parsed.options) {
    io.stderr(`sverklo audit-diff: ${parsed.error ?? "no options"}\n`);
    return EXIT_CONFIG_ERROR;
  }
  const options = parsed.options;

  const { getProjectConfig } = await import("../utils/config.js");
  const config = getProjectConfig(options.projectPath);

  if (!existsSync(config.dbPath)) {
    io.stdout(
      `sverklo audit-diff: no graph index found at ${config.dataDir}\n\n  Run \`sverklo init\` to set up the index, then re-run audit-diff.\n`,
    );
    return EXIT_CONFIG_ERROR;
  }

  const { Indexer } = await import("../indexer/indexer.js");
  const indexer = new Indexer(config);

  try {
    const deps: RunDependencies = {
      graph: indexer.graphStore,
      resolver: {
        pathToId: (p: string) => indexer.fileStore.findByPath(p)?.id ?? null,
        idToPath: (id: number) => {
          for (const f of indexer.fileStore.getAll()) {
            if (f.id === id) return f.path;
          }
          return null;
        },
      },
      dbPath: config.dbPath,
    };

    const { report, exitCode, warning } = runAuditDiff(options, deps);

    if (warning) io.stderr(`${warning}\n`);

    if (options.format === "json") {
      io.stdout(`${toJSON(report)}\n`);
    } else {
      const text = toHuman(report, options.verbose);
      if (text) io.stdout(`${text}\n`);
    }

    return exitCode;
  } finally {
    if (typeof (indexer as { close?: () => void }).close === "function") {
      (indexer as unknown as { close: () => void }).close();
    }
  }
}

import { resolve } from "node:path";
import { runResearchBench, formatReport } from "./runner.ts";

// Entry point for `npm run bench:research`. Minimal CLI — defaults to
// running against sverklo's own repo so new contributors can see the
// eval light up without extra setup.

const args = process.argv.slice(2);
const flagVal = (name: string, fallback?: string): string | undefined => {
  const idx = args.indexOf(name);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  const prefixed = args.find((a) => a.startsWith(`${name}=`));
  if (prefixed) return prefixed.slice(name.length + 1);
  return fallback;
};

const repoRoot = resolve(flagVal("--repo", process.cwd())!);
const dataset = flagVal("--dataset");
const maxStr = flagVal("--max");
const maxTasks = maxStr ? Number(maxStr) : undefined;
const expandGraph = args.includes("--expand-graph");

console.log(
  `[bench:research] repo=${repoRoot}${dataset ? ` dataset=${dataset}` : ""}${maxTasks ? ` max=${maxTasks}` : ""}${expandGraph ? " (expand_graph=on)" : ""}`
);

const summary = await runResearchBench({
  repoRoot,
  datasetPath: dataset ? resolve(dataset) : undefined,
  maxTasks,
  expandGraph,
});

console.log("\n" + formatReport(summary));

if (summary.avg_recall < 0.5) {
  // Surface this as a CI signal — research eval below 50% recall is a
  // red flag that investigate has regressed.
  process.exit(2);
}

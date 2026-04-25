import { resolve } from "node:path";
import { runPatternBench, formatReport } from "./runner.ts";

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

console.log(`[bench:patterns] repo=${repoRoot}${dataset ? ` dataset=${dataset}` : ""}`);

const summary = await runPatternBench({
  repoRoot,
  datasetPath: dataset ? resolve(dataset) : undefined,
});

console.log("\n" + formatReport(summary));

if (summary.scored_tasks === 0) {
  console.log(
    "\n_No symbols had pattern annotations — run `sverklo enrich-patterns` first._"
  );
  process.exit(0);
}

if (summary.forbidden_hits_total > 0) {
  console.error(`\n✗ Forbidden patterns hit ${summary.forbidden_hits_total} time(s) — labeler is mis-tagging.`);
  process.exit(2);
}

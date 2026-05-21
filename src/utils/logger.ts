const LOG_ENABLED = process.env.SVERKLO_DEBUG === "1";

export function log(msg: string, ...args: unknown[]): void {
  if (LOG_ENABLED) {
    process.stderr.write(`[sverklo] ${msg}\n`);
    if (args.length > 0) {
      process.stderr.write(JSON.stringify(args, null, 2) + "\n");
    }
  }
}

/**
 * Always-on telemetry/timing line. Used by --timing flag on
 * `sverklo reindex` so users get phase breakdowns without
 * also opting into the noisy SVERKLO_DEBUG firehose. Dogfood
 * perf review 2026-05-14 (Issue I3).
 */
export function logTiming(msg: string): void {
  if (process.env.SVERKLO_TIMING === "1") {
    process.stderr.write(`[timing] ${msg}\n`);
  }
}

/**
 * Always-on summary line. Used by the indexer for the final "Indexing
 * complete" output so users see total elapsed time on every flow that
 * triggers indexing (`sverklo audit`, `sverklo index`, etc.), without
 * needing to opt into SVERKLO_DEBUG. Issue #54.
 */
export function logSummary(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

export function logError(msg: string, err?: unknown): void {
  process.stderr.write(`[sverklo:error] ${msg}\n`);
  if (err instanceof Error) {
    process.stderr.write(`  ${err.message}\n`);
  }
}

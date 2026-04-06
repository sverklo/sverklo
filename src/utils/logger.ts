const LOG_ENABLED = process.env.CODESEARCH_DEBUG === "1";

export function log(msg: string, ...args: unknown[]): void {
  if (LOG_ENABLED) {
    process.stderr.write(`[codesearch] ${msg}\n`);
    if (args.length > 0) {
      process.stderr.write(JSON.stringify(args, null, 2) + "\n");
    }
  }
}

export function logError(msg: string, err?: unknown): void {
  process.stderr.write(`[codesearch:error] ${msg}\n`);
  if (err instanceof Error) {
    process.stderr.write(`  ${err.message}\n`);
  }
}

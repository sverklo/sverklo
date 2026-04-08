// Runtime mode selection (issue #12).
//
// Sverklo is local-first by default and intentionally so. But a shared /
// team / cloud story is a natural monetization path for later. To avoid
// painting ourselves into a corner, we introduce the mode concept now
// as a single seam the rest of the code can branch on.
//
// Three modes:
//
//   embedded (default)
//     Current behavior. Indexes live in ~/.sverklo/<project>/, one
//     process per project, nothing remote. Zero config. Everything
//     works without opting in.
//
//   shared (reserved)
//     A local daemon process holds indexes for multiple projects and
//     multiple MCP server invocations connect to it. Useful for teams
//     running multiple checkouts on the same laptop, or for the
//     eventual "team cache" feature. NOT YET IMPLEMENTED.
//
//   cloud (reserved)
//     A hosted sverklo endpoint running the same tool set against
//     centrally-indexed repos. For the eventual Sverklo Team tier.
//     NOT YET IMPLEMENTED.
//
// The mode resolver below is the single place where the CLI flag /
// env var is parsed. If you need mode-specific behavior, call
// getMode() and branch on the return value — don't re-parse.
//
// Hard-failure rule (inspired by Qdrant MCP's QDRANT_LOCAL_PATH vs
// QDRANT_URL split): ambiguous config is an error, never a silent
// fallback. If a user sets BOTH --mode cloud AND a local path, crash
// with a clear message so they know to pick one.

export type SverkloMode = "embedded" | "shared" | "cloud";

export interface ModeResolution {
  mode: SverkloMode;
  reason: string;
}

export function resolveMode(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env
): ModeResolution {
  // Precedence: CLI flag > env var > default.
  let fromArgv: SverkloMode | null = null;
  for (const arg of argv) {
    if (arg.startsWith("--mode=")) {
      const val = arg.split("=")[1];
      if (isSverkloMode(val)) fromArgv = val;
    }
  }
  if (fromArgv) {
    return { mode: fromArgv, reason: `--mode=${fromArgv}` };
  }

  const fromEnv = env.SVERKLO_MODE;
  if (fromEnv && isSverkloMode(fromEnv)) {
    return { mode: fromEnv, reason: `SVERKLO_MODE=${fromEnv}` };
  }
  if (fromEnv && !isSverkloMode(fromEnv)) {
    throw new SverkloModeError(
      `Invalid SVERKLO_MODE=${fromEnv}. Must be one of: embedded, shared, cloud.`
    );
  }

  return { mode: "embedded", reason: "default" };
}

export class SverkloModeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SverkloModeError";
  }
}

function isSverkloMode(value: string | undefined): value is SverkloMode {
  return value === "embedded" || value === "shared" || value === "cloud";
}

/**
 * Produce a clear, user-facing error for modes that are reserved but
 * not yet implemented. Called from the CLI before attempting to start
 * the server in an unsupported mode. We explicitly link the tracking
 * issue so users have a concrete next step.
 */
export function notYetImplemented(mode: SverkloMode): string {
  if (mode === "shared") {
    return [
      "Sverklo 'shared' mode is reserved for a future release and not yet implemented.",
      "",
      "Shared mode will let a local sverklo daemon hold indexes for multiple",
      "projects and serve multiple MCP server invocations. Tracked in:",
      "",
      "  https://github.com/sverklo/sverklo/issues/12",
      "",
      "For now, run each project with the default 'embedded' mode:",
      "",
      "  sverklo /path/to/project",
      "",
    ].join("\n");
  }
  if (mode === "cloud") {
    return [
      "Sverklo 'cloud' mode is reserved for the eventual Sverklo Team tier",
      "and not yet implemented.",
      "",
      "Cloud mode will talk to a hosted sverklo endpoint running the same",
      "tool set against centrally-indexed repos. Tracked in:",
      "",
      "  https://github.com/sverklo/sverklo/issues/12",
      "",
      "For now, use 'embedded' mode (the default) — everything stays local",
      "and private.",
      "",
    ].join("\n");
  }
  return "";
}

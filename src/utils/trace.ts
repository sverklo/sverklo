import { appendFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";

const TRACE_ENABLED =
  process.env.SVERKLO_DEBUG === "1" || process.env.SVERKLO_TRACE === "1";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const TRACE_DIR = join(homedir(), ".sverklo");
const TRACE_PATH = join(TRACE_DIR, "trace.log");

export { TRACE_PATH };

function generateTraceId(): string {
  return "t-" + randomBytes(3).toString("hex");
}

/** Keys we include from tool args. Everything else is omitted. */
const SAFE_ARG_KEYS = new Set([
  "query",
  "symbol",
  "name",
  "scope",
  "language",
  "type",
  "token_budget",
  "ref",
  "repo",
  "category",
  "max_files",
  "path",
  "pattern",
]);

function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(args)) {
    if (SAFE_ARG_KEYS.has(key)) {
      const val = args[key];
      // Truncate long string values
      if (typeof val === "string" && val.length > 200) {
        out[key] = val.slice(0, 200) + "...";
      } else {
        out[key] = val;
      }
    }
  }
  return out;
}

function writeLine(line: string): void {
  try {
    mkdirSync(TRACE_DIR, { recursive: true });

    // Rotate: truncate if over 10MB
    try {
      const stat = statSync(TRACE_PATH);
      if (stat.size > MAX_FILE_SIZE) {
        writeFileSync(TRACE_PATH, "");
      }
    } catch {
      // File doesn't exist yet, that's fine
    }

    appendFileSync(TRACE_PATH, line + "\n");
  } catch {
    // Tracing is best-effort, never throw
  }
}

export interface TraceHandle {
  traceId: string;
  end(resultChars: number): void;
  error(err: unknown): void;
}

/**
 * Start a trace for a tool call. Returns a handle to finalize it.
 * No-ops when tracing is disabled.
 */
export function traceStart(
  tool: string,
  args: Record<string, unknown>
): TraceHandle {
  const traceId = generateTraceId();
  const startMs = Date.now();

  if (TRACE_ENABLED) {
    writeLine(
      JSON.stringify({
        trace: traceId,
        tool,
        phase: "request",
        args: sanitizeArgs(args),
        ts: startMs,
      })
    );
  }

  return {
    traceId,
    end(resultChars: number) {
      if (!TRACE_ENABLED) return;
      writeLine(
        JSON.stringify({
          trace: traceId,
          tool,
          phase: "response",
          duration_ms: Date.now() - startMs,
          result_chars: resultChars,
          ts: Date.now(),
        })
      );
    },
    error(err: unknown) {
      if (!TRACE_ENABLED) return;
      const message = err instanceof Error ? err.message : String(err);
      writeLine(
        JSON.stringify({
          trace: traceId,
          tool,
          phase: "error",
          duration_ms: Date.now() - startMs,
          error: message.slice(0, 500),
          ts: Date.now(),
        })
      );
    },
  };
}

// P2-18: tool-call trajectory ring buffer.
//
// Every dispatched first-party tool call appends a {tool, args_summary, ts}
// record into a per-process ring buffer. When `remember` runs, it pulls the
// recent trajectory and stores it as JSON on the memory row, so future
// readers can ask "why did we decide this?" and get the concrete sequence
// of retrievals that led to the decision.
//
// Buffer cap is intentionally small (16 entries) — a memory's
// provenance is the immediate context, not the whole session.

export interface TrajectoryEntry {
  tool: string;
  args_summary: string;     // human-readable digest of arg keys
  duration_ms: number;
  ts: number;
}

const MAX_ENTRIES = 16;

// Zilliz claude-context compat names — recorded by their underlying handler
// already, no point double-recording. Kept here so trajectory has no cyclic
// import on mcp-server.
const COMPAT_ALIAS_NAMES = new Set<string>([
  "index_codebase",
  "search_code",
  "clear_index",
  "get_indexing_status",
]);

class TrajectoryBuffer {
  private entries: TrajectoryEntry[] = [];

  record(tool: string, args: Record<string, unknown>, duration_ms: number): void {
    // v0.28.0: tools no longer carry a `sverklo_` prefix. Skip Zilliz
    // compat aliases (they're already counted via the underlying handler)
    // and the `remember` consumer (don't record into our own provenance).
    if (COMPAT_ALIAS_NAMES.has(tool)) return;
    if (tool === "remember") return;
    this.entries.push({
      tool,
      args_summary: summariseArgs(args),
      duration_ms,
      ts: Date.now(),
    });
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.shift();
    }
  }

  /**
   * Snapshot the last N entries (default = full buffer). Returns a copy
   * so consumers can serialise without holding a reference.
   */
  snapshot(n = MAX_ENTRIES): TrajectoryEntry[] {
    return this.entries.slice(-n).map((e) => ({ ...e }));
  }

  clear(): void {
    this.entries = [];
  }
}

function summariseArgs(args: Record<string, unknown>): string {
  // Compact "key=val" pairs for the most user-actionable arg names.
  // Avoid recording free-form query text — that's PII-adjacent and
  // grows the row faster than its retrieval value justifies.
  const order = [
    "symbol", "scope", "type", "language", "ref",
    "limit", "token_budget", "budget", "max_hits",
    "expand_graph", "current_file", "format",
  ];
  const out: string[] = [];
  for (const k of order) {
    if (args[k] !== undefined) out.push(`${k}=${formatVal(args[k])}`);
  }
  // If the only arg is `query`, mark its presence without recording it.
  if (out.length === 0 && args.query) out.push("query=…");
  return out.join(" ");
}

function formatVal(v: unknown): string {
  if (typeof v === "string") {
    return v.length > 24 ? `"${v.slice(0, 22)}…"` : `"${v}"`;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `[${v.length}]`;
  return typeof v;
}

export const trajectoryBuffer = new TrajectoryBuffer();

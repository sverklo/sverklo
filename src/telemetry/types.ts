// Telemetry types — the entire schema in one file.
//
// Adding fields here is the only way to expand what telemetry collects.
// Every new field requires a TELEMETRY_DESIGN.md change and a public PR.
//
// What we deliberately do NOT include in this schema:
//   - query strings, code, file paths, symbol names, memory contents
//   - IP addresses, hostnames, usernames, project names
//   - git SHAs, branches, repo URLs
//   - error messages, stack traces
//   - language breakdowns, file counts, repo size
//
// If you can't answer a product question with the 9 fields below,
// telemetry cannot answer it. Add the question to your roadmap, not the schema.

export type Os = "darwin" | "linux" | "win32" | "other";

export type Outcome = "ok" | "error" | "timeout";

// Fixed enum. Order is meaningless. Adding requires a PR.
export type EventType =
  | "init.run"
  | "init.detected.claude-code"
  | "init.detected.cursor"
  | "init.detected.windsurf"
  | "init.detected.vscode"
  | "init.detected.jetbrains"
  | "init.detected.antigravity"
  | "doctor.run"
  | "doctor.issue"
  | "index.cold_start"
  | "index.refresh"
  | "tool.call"
  | "memory.write"
  | "memory.read"
  | "memory.staleness_detected"
  | "session.heartbeat"
  | "opt_in"
  | "opt_out";

export interface Event {
  install_id: string; // UUID v4, generated locally on opt-in
  version: string; // sverklo version, e.g. "0.2.10"
  os: Os;
  node_major: number; // 20, 22, etc
  event: EventType;
  tool: string | null; // sverklo_* tool name, null for non-tool events
  outcome: Outcome;
  duration_ms: number; // integer milliseconds
  // ts is added server-side; never sent by the client.
}

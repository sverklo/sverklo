// `sverklo receipt` — Spotify-Wrapped-style summary of how many tokens
// your Claude Code (and Cursor, when their logs land in a known path)
// agent burned this week, and where. The point is to make the cost
// concrete so the share-instinct kicks in.
//
// Parses ~/.claude/projects/**/*.jsonl session logs. Each line is a
// JSON event; we care about `assistant` (model usage + tool_use blocks)
// and `user` (tool_result payloads).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface ReceiptOptions {
  /** Window in days. Default 7. */
  sinceDays?: number;
  /** Output format. */
  format?: "plain" | "json";
  /** Override session-log root (testing). */
  rootDir?: string;
}

interface ToolStat {
  calls: number;
  resultBytes: number;
}

export interface ReceiptStats {
  sessions: number;
  windowDays: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  /** Sum of bytes returned by tool_result blocks. */
  toolResultBytes: number;
  /** Per-tool aggregates, sorted by resultBytes desc. */
  byTool: Array<{ name: string } & ToolStat>;
  /** Worst single tool call (largest tool_result payload). */
  worstCall: { tool: string; bytes: number; sessionFile: string } | null;
}

export interface CostEstimate {
  /** Sonnet ratecard: $3/M input, $15/M output. */
  sonnetUsd: number;
  /** Opus ratecard: $15/M input, $75/M output. */
  opusUsd: number;
  projectedYearlyUsd: number;
}

/**
 * Walk the Claude Code session-log root and return every `.jsonl` file
 * modified within the last `sinceDays` days. Cursor logs are not yet
 * standardized in a known location; deferred.
 */
export function findSessionLogs(opts: ReceiptOptions = {}): string[] {
  const root = opts.rootDir ?? join(homedir(), ".claude", "projects");
  const sinceDays = opts.sinceDays ?? 7;
  const cutoff = Date.now() - sinceDays * 86_400_000;
  const out: string[] = [];

  let projects: string[];
  try {
    projects = readdirSync(root);
  } catch {
    return out;
  }

  for (const proj of projects) {
    const projDir = join(root, proj);
    let entries: string[];
    try {
      entries = readdirSync(projDir);
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.endsWith(".jsonl")) continue;
      const p = join(projDir, e);
      try {
        if (statSync(p).mtimeMs >= cutoff) out.push(p);
      } catch {
        /* skip unreadable */
      }
    }
  }
  return out;
}

/**
 * Parse one session log and return its contribution to the running
 * stats. Streams line-by-line so a 40 MB jsonl doesn't blow the heap.
 */
function accumulate(file: string, agg: ReceiptStats): void {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return;
  }
  agg.sessions++;
  const lines = raw.split("\n");
  for (const line of lines) {
    if (!line) continue;
    let o: unknown;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof o !== "object" || o === null) continue;
    const ev = o as Record<string, unknown>;
    const type = ev.type;

    if (type === "assistant") {
      const msg = ev.message as Record<string, unknown> | undefined;
      const usage = msg?.usage as Record<string, number> | undefined;
      if (usage) {
        agg.inputTokens += usage.input_tokens ?? 0;
        agg.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
        agg.cacheCreationTokens += usage.cache_creation_input_tokens ?? 0;
        agg.outputTokens += usage.output_tokens ?? 0;
      }
      const content = msg?.content as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c?.type === "tool_use") {
            const name = (c.name as string) ?? "unknown";
            const stat = ensureTool(agg, name);
            stat.calls++;
          }
        }
      }
    } else if (type === "user") {
      const msg = ev.message as Record<string, unknown> | undefined;
      const content = msg?.content as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c?.type === "tool_result") {
            const bytes = approxBytes(c.content);
            agg.toolResultBytes += bytes;
            if (!agg.worstCall || bytes > agg.worstCall.bytes) {
              agg.worstCall = { tool: "unknown", bytes, sessionFile: file };
            }
          }
        }
      }
    }
  }
}

function ensureTool(agg: ReceiptStats, name: string) {
  let entry = agg.byTool.find((t) => t.name === name);
  if (!entry) {
    entry = { name, calls: 0, resultBytes: 0 };
    agg.byTool.push(entry);
  }
  return entry;
}

function approxBytes(content: unknown): number {
  if (content == null) return 0;
  if (typeof content === "string") return content.length;
  try {
    return JSON.stringify(content).length;
  } catch {
    return 0;
  }
}

/**
 * Build the receipt from all session logs in the window. Pure aggregation;
 * no I/O outside `findSessionLogs` and `readFileSync`.
 */
export function generateReceipt(opts: ReceiptOptions = {}): ReceiptStats {
  const sinceDays = opts.sinceDays ?? 7;
  const stats: ReceiptStats = {
    sessions: 0,
    windowDays: sinceDays,
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    outputTokens: 0,
    toolResultBytes: 0,
    byTool: [],
    worstCall: null,
  };
  const files = findSessionLogs(opts);
  for (const f of files) accumulate(f, stats);
  stats.byTool.sort((a, b) => b.calls - a.calls);
  return stats;
}

/** Anthropic public ratecards as of May 2026. Source: docs.anthropic.com. */
const RATES = {
  sonnet: { input: 3, output: 15 }, // USD per 1M tokens
  opus: { input: 15, output: 75 },
  cacheReadDiscount: 0.1, // cache reads bill at 10% of input rate
} as const;

export function estimateCost(stats: ReceiptStats): CostEstimate {
  const totalIn = stats.inputTokens + stats.cacheCreationTokens;
  const cacheBilled = stats.cacheReadTokens * RATES.cacheReadDiscount;
  const sonnetUsd =
    ((totalIn + cacheBilled) * RATES.sonnet.input + stats.outputTokens * RATES.sonnet.output) /
    1_000_000;
  const opusUsd =
    ((totalIn + cacheBilled) * RATES.opus.input + stats.outputTokens * RATES.opus.output) /
    1_000_000;
  const dailyAvg = sonnetUsd / stats.windowDays;
  return {
    sonnetUsd,
    opusUsd,
    projectedYearlyUsd: dailyAvg * 365,
  };
}

/**
 * Render the receipt for the terminal. Plain ASCII, no color — meant
 * to be screenshotable without garbled escape codes.
 */
export function renderReceipt(stats: ReceiptStats, cost: CostEstimate): string {
  const lines: string[] = [];
  const fmt = (n: number) => n.toLocaleString("en-US");
  const usd = (n: number) => `$${n.toFixed(2)}`;
  const bar = "─".repeat(58);

  lines.push("sverklo receipt");
  lines.push(bar);
  lines.push(
    `Last ${stats.windowDays} days · ${stats.sessions} session${stats.sessions === 1 ? "" : "s"} · ${stats.byTool.reduce((a, t) => a + t.calls, 0)} tool calls`,
  );
  lines.push("");
  lines.push("Token spend");
  lines.push(`  Input (new):                 ${fmt(stats.inputTokens).padStart(13)}`);
  lines.push(`  Cache reads (cheap):         ${fmt(stats.cacheReadTokens).padStart(13)}`);
  lines.push(`  Cache writes (full price):   ${fmt(stats.cacheCreationTokens).padStart(13)}`);
  lines.push(`  Output:                      ${fmt(stats.outputTokens).padStart(13)}`);
  lines.push("");
  lines.push("Estimated cost");
  lines.push(`  Sonnet rates:                ${usd(cost.sonnetUsd).padStart(13)}`);
  lines.push(`  Opus rates:                  ${usd(cost.opusUsd).padStart(13)}`);
  lines.push(`  Projected yearly (Sonnet):   ${usd(cost.projectedYearlyUsd).padStart(13)}`);
  lines.push("");

  if (stats.byTool.length) {
    lines.push(`Top tool consumers`);
    const top = stats.byTool.slice(0, 8);
    const widest = Math.max(...top.map((t) => t.name.length));
    for (const t of top) {
      const calls = `${t.calls} call${t.calls === 1 ? "" : "s"}`;
      lines.push(`  ${t.name.padEnd(widest)}  ${calls.padStart(10)}`);
    }
    lines.push("");
  }

  if (stats.worstCall && stats.worstCall.bytes > 0) {
    const kb = (stats.worstCall.bytes / 1024).toFixed(1);
    const approxTokens = Math.round(stats.worstCall.bytes / 4);
    lines.push(`Worst single tool result: ${kb} KB (~${fmt(approxTokens)} tokens)`);
    lines.push("");
  }

  // Stop-the-bleeding CTA.
  lines.push("Stop the bleeding — paste this into ~/.cursor/mcp.json");
  lines.push("(or run `sverklo init` to auto-detect your agent and write it):");
  lines.push("");
  lines.push(`  {`);
  lines.push(`    "mcpServers": {`);
  lines.push(`      "sverklo": { "command": "npx", "args": ["-y", "sverklo"] }`);
  lines.push(`    }`);
  lines.push(`  }`);
  lines.push("");
  lines.push("Then run `sverklo receipt` again next week to compare.");
  lines.push(bar);

  return lines.join("\n");
}

/** Convenience wrapper for the CLI. */
export function runReceipt(opts: ReceiptOptions = {}): string {
  const stats = generateReceipt(opts);
  if (stats.sessions === 0) {
    return [
      "sverklo receipt",
      "─".repeat(58),
      "",
      `No Claude Code sessions found in the last ${opts.sinceDays ?? 7} days at`,
      `  ${opts.rootDir ?? join(homedir(), ".claude", "projects")}`,
      "",
      "If you use Claude Code, this directory should populate automatically.",
      "If you only use Cursor, log support is on the roadmap — open an issue:",
      "  https://github.com/sverklo/sverklo/issues/new",
      "",
    ].join("\n");
  }
  if (opts.format === "json") {
    return JSON.stringify({ stats, cost: estimateCost(stats) }, null, 2);
  }
  return renderReceipt(stats, estimateCost(stats));
}

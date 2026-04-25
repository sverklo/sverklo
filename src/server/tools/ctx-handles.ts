import type { Indexer } from "../../indexer/indexer.js";
import { parseHandleUri } from "../../storage/handle-store.js";
import { grepResults, headResults, splitBlocks } from "../../search/post-filter.js";
import { getGitState } from "../../memory/git-state.js";

// ctx_slice / ctx_grep / ctx_stats (v0.15, P1-8). Operate on a persistent
// ctx:// handle returned by search-family tools. Compared with the v0.13
// post-filter primitives (grep_results / head_results / ctx_peek), these
// survive across MCP sessions and detect git-SHA drift.

export const ctxSliceTool = {
  name: "sverklo_ctx_slice",
  description:
    "Return a byte-slice of a context handle (ctx://<tool>/<id>). Use to drill into the body without " +
    "rerunning the original retrieval. Returns 'expired' if the handle's pinned SHA no longer matches.",
  inputSchema: {
    type: "object" as const,
    properties: {
      uri: { type: "string", description: "ctx://<tool>/<id> URI" },
      offset: { type: "number", description: "Byte offset (default 0)" },
      length: { type: "number", description: "Byte length (default 4000)" },
    },
    required: ["uri"],
  },
};

export const ctxGrepTool = {
  name: "sverklo_ctx_grep",
  description:
    "Filter the result blocks of a context handle by regex. Operates on the cached body — no second " +
    "retrieval. Returns the narrowed body inline.",
  inputSchema: {
    type: "object" as const,
    properties: {
      uri: { type: "string" },
      pattern: { type: "string", description: "Regex (or literal if regex is invalid)." },
      head: { type: "number", description: "Optional cap on returned blocks." },
    },
    required: ["uri", "pattern"],
  },
};

export const ctxStatsTool = {
  name: "sverklo_ctx_stats",
  description:
    "Inspect a context handle without consuming it: tool, age, block count, byte size, fresh/expired.",
  inputSchema: {
    type: "object" as const,
    properties: {
      uri: { type: "string" },
    },
    required: ["uri"],
  },
};

function resolveBody(indexer: Indexer, uri: string): { body: string; sha: string | null } | string {
  const parsed = parseHandleUri(uri);
  if (!parsed) return `Invalid handle URI: ${uri}. Expected format: ctx://<tool>/<id>.`;

  const currentSha = getGitState(indexer.rootPath).sha;
  const handle = indexer.handleStore.getFresh(parsed.id, currentSha);
  if (!handle) {
    const raw = indexer.handleStore.get(parsed.id);
    if (!raw) return `Handle ${parsed.id} not found (TTL expired or never created).`;
    if (raw.expires_at < Date.now()) return `Handle ${parsed.id} expired.`;
    return `Handle ${parsed.id} pinned to SHA ${raw.sha?.slice(0, 7) ?? "(none)"}, but tree is at ${currentSha?.slice(0, 7) ?? "(none)"}. Re-run the original tool to get a fresh handle.`;
  }
  return { body: handle.body, sha: handle.sha };
}

export function handleCtxSlice(indexer: Indexer, args: Record<string, unknown>): string {
  const uri = args.uri as string | undefined;
  if (!uri) return "ctx_slice requires `uri`.";
  const r = resolveBody(indexer, uri);
  if (typeof r === "string") return r;

  const offset = typeof args.offset === "number" ? Math.max(0, args.offset) : 0;
  const length = typeof args.length === "number" ? Math.max(1, args.length) : 4000;
  const slice = r.body.slice(offset, offset + length);
  const tag = `_slice offset=${offset} length=${slice.length} of ${r.body.length}_`;
  return `${slice}\n\n${tag}`;
}

export function handleCtxGrep(indexer: Indexer, args: Record<string, unknown>): string {
  const uri = args.uri as string | undefined;
  const pattern = args.pattern as string | undefined;
  if (!uri || !pattern) return "ctx_grep requires `uri` and `pattern`.";
  const r = resolveBody(indexer, uri);
  if (typeof r === "string") return r;

  const grepped = grepResults(r.body, pattern);
  if (typeof args.head === "number" && args.head > 0) {
    const headed = headResults(grepped.text, args.head);
    return headed.text;
  }
  return grepped.text;
}

export function handleCtxStats(indexer: Indexer, args: Record<string, unknown>): string {
  const uri = args.uri as string | undefined;
  if (!uri) return "ctx_stats requires `uri`.";
  const parsed = parseHandleUri(uri);
  if (!parsed) return `Invalid handle URI: ${uri}.`;
  const raw = indexer.handleStore.get(parsed.id);
  if (!raw) return `Handle ${parsed.id} not found.`;

  const ageMs = Date.now() - raw.created_at;
  const blocks = splitBlocks(raw.body).blocks.length;
  const currentSha = getGitState(indexer.rootPath).sha;
  const expired = raw.expires_at < Date.now();
  const shaShifted =
    !!currentSha && !!raw.sha && currentSha !== raw.sha;

  const lines: string[] = [];
  lines.push(`## ${uri}`);
  lines.push(`- tool: ${raw.tool}`);
  lines.push(`- age: ${formatMs(ageMs)}`);
  lines.push(`- size: ${raw.body.length} bytes / ${blocks} block(s)`);
  lines.push(`- pinned SHA: ${raw.sha?.slice(0, 7) ?? "(none)"}`);
  lines.push(`- current SHA: ${currentSha?.slice(0, 7) ?? "(none)"}`);
  if (expired) lines.push("- **expired**");
  else if (shaShifted) lines.push("- **stale** (SHA shifted; rerun for fresh handle)");
  else lines.push("- fresh");
  return lines.join("\n");
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

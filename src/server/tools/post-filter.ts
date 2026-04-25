import { responseStore } from "../response-store.js";
import { grepResults, headResults, ctxPeek } from "../../search/post-filter.js";

export const grepResultsTool = {
  name: "sverklo_grep_results",
  description:
    "Filter the result blocks of a prior sverklo tool call by a regex pattern — " +
    "operates on the cached text so no second retrieval happens. Pass the " +
    "response_id returned on any search/refs/impact call.",
  inputSchema: {
    type: "object" as const,
    properties: {
      response_id: { type: "string", description: "The rsp_... id from an earlier call." },
      pattern: { type: "string", description: "Regex (or literal if regex is invalid)." },
    },
    required: ["response_id", "pattern"],
  },
};

export const headResultsTool = {
  name: "sverklo_head_results",
  description:
    "Keep only the top N result blocks of a prior sverklo tool call. Cheap way " +
    "to shrink a chatty response when you just need the top hit.",
  inputSchema: {
    type: "object" as const,
    properties: {
      response_id: { type: "string" },
      n: { type: "number", description: "Max blocks to keep." },
    },
    required: ["response_id", "n"],
  },
};

export const ctxPeekTool = {
  name: "sverklo_ctx_peek",
  description:
    "Return a byte-slice from a single result block of a prior tool call. " +
    "Use when the agent needs to inspect a specific offset without the full body.",
  inputSchema: {
    type: "object" as const,
    properties: {
      response_id: { type: "string" },
      hit_index: { type: "number", description: "0-based index into the block list." },
      offset: { type: "number", description: "Byte offset into the block body." },
      len: { type: "number", description: "Byte length to return." },
    },
    required: ["response_id", "hit_index", "offset", "len"],
  },
};

function resolve(args: Record<string, unknown>): string | null {
  const id = args.response_id as string | undefined;
  if (!id) return null;
  return responseStore.get(id)?.text ?? null;
}

export function handleGrepResults(args: Record<string, unknown>): string {
  const text = resolve(args);
  if (text === null) return `No response cached for id=${args.response_id}. Did the 10 min TTL expire?`;
  const { text: out } = grepResults(text, args.pattern as string);
  return out;
}

export function handleHeadResults(args: Record<string, unknown>): string {
  const text = resolve(args);
  if (text === null) return `No response cached for id=${args.response_id}.`;
  const { text: out } = headResults(text, args.n as number);
  return out;
}

export function handleCtxPeek(args: Record<string, unknown>): string {
  const text = resolve(args);
  if (text === null) return `No response cached for id=${args.response_id}.`;
  const { text: out } = ctxPeek(
    text,
    args.hit_index as number,
    args.offset as number,
    args.len as number
  );
  return out;
}

import type { Indexer } from "./indexer.js";
import { ollamaChat, parseJsonResponse, type OllamaChatOptions } from "../utils/ollama.js";
import { createHash } from "node:crypto";

// P1-12: top-N PageRank symbols get an LLM-generated one-line purpose
// stored on chunks.purpose. Offline pass; runs via the
// `sverklo enrich-symbols` CLI. Cached by content hash so re-runs are
// nearly free.

export interface EnrichOptions extends OllamaChatOptions {
  topN?: number;            // default 200
  force?: boolean;
  onProgress?: (done: number, total: number, symbol: string) => void;
}

export interface EnrichResult {
  enriched: number;
  skipped: number;
  failed: number;
  failures: Array<{ symbol: string; reason: string }>;
}

const SYSTEM_PROMPT =
  "You write one-line purpose descriptions for code symbols. " +
  "Return STRICT JSON: {\"purpose\":\"…\"}. " +
  "Style: factual, concrete, ≤140 chars, present tense, names what it does and why. " +
  "If the symbol is trivial (boilerplate, getter, generated), use {\"purpose\":\"\"}.";

export async function enrichSymbolPurposes(
  indexer: Indexer,
  opts: EnrichOptions = {}
): Promise<EnrichResult> {
  const topN = opts.topN ?? 200;

  // Walk top-PageRank files, then collect their definition-typed chunks
  // until we reach topN. This biases toward structurally-important symbols.
  const targets: Array<{ chunkId: number; symbol: string; content: string; hash: string }> = [];
  const files = indexer.fileStore.getAll();
  for (const f of files) {
    if (targets.length >= topN) break;
    for (const c of indexer.chunkStore.getByFile(f.id)) {
      if (targets.length >= topN) break;
      if (!c.name) continue;
      if (
        !["function", "class", "method", "type", "interface", "module"].includes(c.type)
      )
        continue;
      const hash = createHash("sha256").update(c.content).digest("hex").slice(0, 16);
      targets.push({ chunkId: c.id, symbol: c.name, content: c.content, hash });
    }
  }

  const result: EnrichResult = { enriched: 0, skipped: 0, failed: 0, failures: [] };

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    opts.onProgress?.(i, targets.length, t.symbol);

    if (!opts.force) {
      // Skip if a purpose already exists with a content-hash prefix marker
      // we wrote on the previous run.
      const existing = indexer.chunkStore.getPurpose(t.chunkId);
      if (existing && existing.startsWith(`[${t.hash}] `)) {
        result.skipped++;
        continue;
      }
    }

    const prompt = buildSymbolPrompt(t.symbol, t.content);
    const chat = await ollamaChat(prompt, { ...opts, system: SYSTEM_PROMPT, format: "json" });
    if (!chat.ok) {
      result.failed++;
      result.failures.push({ symbol: t.symbol, reason: chat.message });
      continue;
    }
    const parsed = parseJsonResponse<{ purpose: string }>(chat.content);
    if (!parsed.ok) {
      result.failed++;
      result.failures.push({ symbol: t.symbol, reason: parsed.message });
      continue;
    }
    const purpose = (parsed.value.purpose ?? "").trim();
    if (!purpose) {
      result.skipped++;
      continue;
    }
    // Store with a content-hash prefix so we can detect staleness cheaply.
    indexer.chunkStore.updatePurpose(t.chunkId, `[${t.hash}] ${purpose.slice(0, 140)}`);
    result.enriched++;
  }

  return result;
}

function buildSymbolPrompt(symbol: string, content: string): string {
  // Snip the body so a 200-line class doesn't blow the prompt budget.
  const lines = content.split("\n").slice(0, 40);
  const body = lines.join("\n");
  return [
    `Symbol: ${symbol}`,
    "",
    "Body:",
    "```",
    body,
    "```",
    "",
    "Return JSON {\"purpose\":\"...\"} — one line, ≤140 chars.",
  ].join("\n");
}

/**
 * Strip the content-hash prefix from a stored purpose for display.
 */
export function displayPurpose(purposeField: string | null): string | null {
  if (!purposeField) return null;
  const m = /^\[[a-f0-9]{16}\] (.*)$/.exec(purposeField);
  return m ? m[1] : purposeField;
}

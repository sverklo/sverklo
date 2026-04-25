import type { Indexer } from "./indexer.js";
import { ollamaChat, parseJsonResponse, type OllamaChatOptions } from "../utils/ollama.js";
import { PATTERN_TAXONOMY, PATTERN_SET } from "../storage/pattern-store.js";
import { createHash } from "node:crypto";

// P2-17: closed-taxonomy pattern labeler. Asks the LLM "which of these
// design patterns (if any) does this symbol implement?" and stores
// edges only for taxonomy-valid answers above a confidence threshold.
//
// The closed taxonomy is the quality gate: even if the model
// hallucinates, we drop everything outside the allow-list. Confidence
// cut-off (default 0.6) drops fuzzy matches.

export interface LabelPatternsOptions extends OllamaChatOptions {
  topN?: number;
  force?: boolean;
  minConfidence?: number;       // default 0.6
  onProgress?: (done: number, total: number, symbol: string) => void;
}

export interface LabelPatternsResult {
  scanned: number;
  labeled: number;
  skipped_by_taxonomy: number;
  skipped_low_conf: number;
  failed: number;
  failures: Array<{ symbol: string; reason: string }>;
}

interface PatternResponseRow {
  pattern: string;
  role?: string | null;
  confidence: number;
}

const SYSTEM_PROMPT =
  `Classify a code symbol against a closed taxonomy of design patterns. ` +
  `Reply with STRICT JSON: {"matches":[{"pattern":"…","role":"…","confidence":0.0-1.0}]}. ` +
  `Use ONLY these pattern names: ${PATTERN_TAXONOMY.join(", ")}. ` +
  `If nothing fits, return {"matches":[]}. Confidence must reflect how clearly ` +
  `the code matches the named pattern — be conservative.`;

export async function labelPatterns(
  indexer: Indexer,
  opts: LabelPatternsOptions = {}
): Promise<LabelPatternsResult> {
  const topN = opts.topN ?? 200;
  const minConfidence = opts.minConfidence ?? 0.6;

  // Same selection as symbol-purpose: top-PageRank definition-typed chunks.
  const targets: Array<{ chunkId: number; symbol: string; content: string; hash: string }> = [];
  for (const f of indexer.fileStore.getAll()) {
    if (targets.length >= topN) break;
    for (const c of indexer.chunkStore.getByFile(f.id)) {
      if (targets.length >= topN) break;
      if (!c.name) continue;
      if (!["function", "class", "method", "type", "interface", "module"].includes(c.type)) continue;
      const hash = createHash("sha256").update(c.content).digest("hex").slice(0, 16);
      targets.push({ chunkId: c.id, symbol: c.name, content: c.content, hash });
    }
  }

  const result: LabelPatternsResult = {
    scanned: targets.length,
    labeled: 0,
    skipped_by_taxonomy: 0,
    skipped_low_conf: 0,
    failed: 0,
    failures: [],
  };

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    opts.onProgress?.(i, targets.length, t.symbol);

    if (!opts.force) {
      // Skip if any existing edge already pins to the same content hash.
      const existing = indexer.patternStore.getByChunk(t.chunkId);
      if (existing.length > 0 && existing[0].content_hash === t.hash) continue;
    }

    const prompt = buildPatternPrompt(t.symbol, t.content);
    const chat = await ollamaChat(prompt, { ...opts, system: SYSTEM_PROMPT, format: "json" });
    if (!chat.ok) {
      result.failed++;
      result.failures.push({ symbol: t.symbol, reason: chat.message });
      continue;
    }
    const parsed = parseJsonResponse<{ matches: PatternResponseRow[] }>(chat.content);
    if (!parsed.ok) {
      result.failed++;
      result.failures.push({ symbol: t.symbol, reason: parsed.message });
      continue;
    }

    indexer.patternStore.deleteForChunk(t.chunkId);

    const matches = Array.isArray(parsed.value.matches) ? parsed.value.matches : [];
    const accepted = matches
      .filter((m) => {
        if (!PATTERN_SET.has(m.pattern)) {
          result.skipped_by_taxonomy++;
          return false;
        }
        if (typeof m.confidence !== "number" || m.confidence < minConfidence) {
          result.skipped_low_conf++;
          return false;
        }
        return true;
      })
      .map((m) => ({
        chunk_id: t.chunkId,
        pattern: m.pattern,
        role: typeof m.role === "string" && m.role ? m.role : null,
        confidence: Math.min(1, Math.max(0, m.confidence)),
        content_hash: t.hash,
      }));

    if (accepted.length > 0) {
      indexer.patternStore.upsertMany(accepted);
      result.labeled++;
    }
  }

  return result;
}

function buildPatternPrompt(symbol: string, content: string): string {
  const lines = content.split("\n").slice(0, 60);
  const body = lines.join("\n");
  return [
    `Symbol: ${symbol}`,
    "",
    "Code:",
    "```",
    body,
    "```",
    "",
    `Pick zero or more design patterns this symbol implements (closed list above). ` +
      `Return JSON {"matches":[{"pattern":"…","role":"…","confidence":0.0-1.0}]}.`,
  ].join("\n");
}

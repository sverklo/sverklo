import type { ChunkStore } from "../storage/chunk-store.js";
import type { DocEdgeStore, DocMentionInput } from "../storage/doc-edge-store.js";
import type { CodeChunk, FileRecord } from "../types/index.js";

// Extract symbol mentions from doc chunks and link them to the symbol graph.
// Three extractors with decreasing confidence:
//
//  1. Backtick spans:   `parseFile`, `User.save()`  → confidence 1.0
//  2. Fenced code ids:  identifiers inside ```lang blocks  → 0.8
//  3. Bare mentions:    word-boundary match of a known top-PR symbol
//                       when it co-occurs with ≥ 1 other known symbol
//                       in the same paragraph  → 0.5
//
// Only doc chunks (type doc_section / doc_code) are linked. Resolution is
// "best effort": we pick the highest-PageRank defining chunk whose name
// matches exactly (case-sensitive). Unresolved mentions are still stored
// with target_chunk_id = NULL so the raw signal survives for later
// consumption.

const MIN_TOKEN_LEN = 3;
const BARE_TOPN = 2000;

export interface DocLinkResult {
  docChunksProcessed: number;
  mentionsCreated: number;
  resolvedCount: number;
}

export function buildDocLinks(
  chunkStore: ChunkStore,
  docEdgeStore: DocEdgeStore,
  fileCache: Map<number, FileRecord>,
  docChunks: CodeChunk[]
): DocLinkResult {
  // Build the "known top-PR symbols" set for bare-match gating. We walk
  // files by PageRank order (fileCache is already sorted DESC when built
  // from fileStore.getAll) and collect chunk names until we hit BARE_TOPN.
  const knownSymbols = collectTopSymbols(chunkStore, fileCache, BARE_TOPN);

  let mentionsCreated = 0;
  let resolvedCount = 0;

  const allInputs: DocMentionInput[] = [];

  for (const doc of docChunks) {
    // Replace any previous mentions for this doc chunk (idempotent re-runs).
    docEdgeStore.deleteForDocChunk(doc.id);

    const extracted = extractMentions(doc, knownSymbols);
    for (const { symbol, kind, confidence } of extracted) {
      const targetChunk = resolveSymbol(chunkStore, symbol);
      allInputs.push({
        doc_chunk_id: doc.id,
        target_symbol: symbol,
        target_chunk_id: targetChunk?.id ?? null,
        match_kind: kind,
        confidence,
      });
      if (targetChunk) resolvedCount++;
      mentionsCreated++;
    }
  }

  docEdgeStore.insertMany(allInputs);

  return {
    docChunksProcessed: docChunks.length,
    mentionsCreated,
    resolvedCount,
  };
}

interface Extracted {
  symbol: string;
  kind: "backtick" | "fenced_code" | "bare";
  confidence: number;
}

/**
 * Pull candidate symbol mentions out of a single doc chunk. Dedups on
 * (symbol, kind) so the same symbol mentioned twice in backticks inside one
 * chunk still produces one edge.
 */
export function extractMentions(doc: CodeChunk, knownSymbols: Set<string>): Extracted[] {
  const out = new Map<string, Extracted>();

  // 1. Backtick-fenced spans. Content between backticks can be anything
  // (parentheses, args, etc.) — we pull the leading identifier + any
  // dotted sub-parts out of whatever's inside.
  const backtickRe = /`([^`\n]+?)`/g;
  let m: RegExpExecArray | null;
  while ((m = backtickRe.exec(doc.content)) !== null) {
    const inner = m[1].trim();
    // Leading identifier (optionally dotted): parseFile, Foo.bar, a.b.c
    const idMatch = /^([A-Za-z_][\w.]*)/.exec(inner);
    if (!idMatch) continue;
    const raw = idMatch[1];
    const parts = raw.split(".");
    for (const p of parts) {
      if (p.length >= MIN_TOKEN_LEN) {
        maybeSet(out, p, "backtick", 1.0);
      }
    }
    if (raw !== parts[0] && raw.length >= MIN_TOKEN_LEN) {
      maybeSet(out, raw, "backtick", 1.0);
    }
  }

  // 2. Fenced code blocks — identifiers in them get medium confidence.
  //    For doc_code chunks themselves, the whole body is the code block.
  const codeBlocks =
    doc.type === "doc_code"
      ? [doc.content]
      : extractFencedBodies(doc.content);
  for (const body of codeBlocks) {
    const idRe = /\b([A-Za-z_][\w]*)\b/g;
    let im: RegExpExecArray | null;
    while ((im = idRe.exec(body)) !== null) {
      const tok = im[1];
      if (tok.length < MIN_TOKEN_LEN) continue;
      if (LANG_KEYWORDS.has(tok.toLowerCase())) continue;
      // Only accept fenced-code ids that also appear in the known-symbol
      // set — otherwise every `const` / `let` floods the mention table.
      if (!knownSymbols.has(tok)) continue;
      maybeSet(out, tok, "fenced_code", 0.8);
    }
  }

  // 3. Bare mentions — prose paragraphs mentioning a known top-PR symbol
  //    by name, provided ≥ 1 OTHER known symbol appears in the same
  //    paragraph. This filters casual uses of short identifiers that also
  //    happen to be English words.
  const paragraphs = splitParagraphs(doc.content);
  for (const para of paragraphs) {
    const hits = new Set<string>();
    const wordRe = /\b([A-Za-z_][\w]{2,})\b/g;
    let wm: RegExpExecArray | null;
    while ((wm = wordRe.exec(para)) !== null) {
      const tok = wm[1];
      if (knownSymbols.has(tok)) hits.add(tok);
    }
    if (hits.size < 2) continue;
    for (const tok of hits) {
      maybeSet(out, tok, "bare", 0.5);
    }
  }

  return Array.from(out.values());
}

function maybeSet(
  out: Map<string, Extracted>,
  symbol: string,
  kind: Extracted["kind"],
  confidence: number
): void {
  const prior = out.get(symbol);
  if (!prior || confidence > prior.confidence) {
    out.set(symbol, { symbol, kind, confidence });
  }
}

function extractFencedBodies(md: string): string[] {
  const out: string[] = [];
  const re = /```[\w+-]*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) out.push(m[1]);
  return out;
}

function splitParagraphs(md: string): string[] {
  return md.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
}

function collectTopSymbols(
  chunkStore: ChunkStore,
  fileCache: Map<number, FileRecord>,
  limit: number
): Set<string> {
  const symbols = new Set<string>();
  // Iterate files in insertion (i.e. PageRank DESC) order.
  for (const file of fileCache.values()) {
    if (symbols.size >= limit) break;
    for (const chunk of chunkStore.getByFile(file.id)) {
      if (!chunk.name) continue;
      if (chunk.type === "doc_section" || chunk.type === "doc_code") continue;
      if (chunk.name.length < MIN_TOKEN_LEN) continue;
      symbols.add(chunk.name);
      if (symbols.size >= limit) break;
    }
  }
  return symbols;
}

function resolveSymbol(chunkStore: ChunkStore, symbol: string): CodeChunk | null {
  const candidates = chunkStore.getByName(symbol, 10);
  // Filter to exact matches only (getByName does a LIKE %%).
  const exact = candidates.filter(
    (c) => c.name === symbol && c.type !== "doc_section" && c.type !== "doc_code"
  );
  if (exact.length === 0) return null;
  // Prefer definitions (class/function/method/interface/type) over plain
  // variable references.
  const rank = (c: CodeChunk): number => {
    switch (c.type) {
      case "class":
      case "interface":
        return 5;
      case "function":
      case "method":
        return 4;
      case "type":
        return 3;
      case "module":
        return 2;
      default:
        return 1;
    }
  };
  exact.sort((a, b) => rank(b) - rank(a));
  return exact[0];
}

// Keyword stoplist used for fenced-code extraction. Not exhaustive but
// covers the common "don't index these as symbols" cases across the
// languages sverklo supports.
const LANG_KEYWORDS = new Set([
  "if", "else", "for", "while", "do", "return", "break", "continue",
  "switch", "case", "default", "try", "catch", "finally", "throw",
  "new", "delete", "this", "super", "null", "true", "false", "undefined",
  "const", "let", "var", "function", "class", "interface", "type",
  "extends", "implements", "public", "private", "protected", "static",
  "import", "export", "from", "as", "default",
  "def", "pass", "lambda", "with", "yield", "async", "await",
  "package", "use", "mod", "pub", "fn", "impl", "self",
  "string", "int", "bool", "float", "void", "any", "number",
  "todo", "xxx", "fixme",
]);

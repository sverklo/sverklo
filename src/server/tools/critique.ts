import type { Indexer } from "../../indexer/indexer.js";
import { verifyEvidence } from "../../memory/evidence.js";
import type { VerifyResult } from "../../types/index.js";

// Deterministic coverage check for agent-produced answers. Takes a list of
// evidence ids the agent cited and returns a structured critique of what's
// missing from the answer relative to the codebase — no LLM call on the
// server side. Pairs with the research recipes in src/server/prompts.ts so
// the host agent can self-check before returning a final answer.
//
// Checks performed:
//   - Evidence verification (every cited id still matches).
//   - PageRank coverage: did the answer touch the top-N structurally
//     important files among the cited set? Missing hubs = likely incomplete.
//   - Dangling symbols: for any symbol the answer names explicitly, was
//     the answer also pointing at its definition (not just references)?
//   - Doc coverage: if doc mentions exist for cited symbols, did the
//     answer acknowledge them?

export const critiqueTool = {
  name: "sverklo_critique",
  description:
    "Deterministic coverage check for an agent's answer. Takes the evidence ids the agent cited " +
    "plus the symbols it discussed; verifies each evidence is still current and flags whether the " +
    "answer missed high-PageRank hubs, symbol definitions, or related doc mentions. Returns a " +
    "structured critique — no LLM call on the server side.",
  inputSchema: {
    type: "object" as const,
    properties: {
      evidence_ids: {
        type: "array",
        items: { type: "string" },
        description: "Evidence ids (from the fenced evidence blocks) that the agent cited.",
      },
      symbols: {
        type: "array",
        items: { type: "string" },
        description: "Symbols the agent discussed by name. Used for hub / doc-coverage checks.",
      },
      claim: {
        type: "string",
        description: "Optional summary of the agent's claim. Echoed in the critique header.",
      },
    },
    required: ["evidence_ids"],
  },
};

export function handleCritique(
  indexer: Indexer,
  args: Record<string, unknown>
): string {
  const evidenceIds = Array.isArray(args.evidence_ids)
    ? (args.evidence_ids as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  const symbols = Array.isArray(args.symbols)
    ? (args.symbols as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  const claim = typeof args.claim === "string" ? args.claim : null;

  if (evidenceIds.length === 0 && symbols.length === 0) {
    return "sverklo_critique requires at least one of `evidence_ids` or `symbols`.";
  }

  // 1. Evidence verification.
  const verify: VerifyResult[] = evidenceIds.map((id) => verifyEvidence(indexer, id));
  const stale = verify.filter(
    (v) => v.status !== "unchanged" && v.status !== "moved"
  );
  const moved = verify.filter((v) => v.status === "moved");

  // 2. Hub coverage. Pull the top-20 PageRank files; cross-reference with
  //    the files cited in verified evidence. If the cited set includes 0
  //    hubs but the agent discussed > 3 symbols, the answer likely missed
  //    a structurally important piece.
  const topFiles = indexer.fileStore.getAll().slice(0, 20).map((f) => f.path);
  const citedFiles = new Set(verify.map((v) => v.file).filter(Boolean) as string[]);
  const hubsCited = topFiles.filter((p) => citedFiles.has(p));
  const missedHubs =
    symbols.length >= 3 && hubsCited.length === 0
      ? topFiles.slice(0, 5)
      : [];

  // 3. Symbol definitions. For each discussed symbol, check that the cited
  //    set contains the definition chunk (type ∈ function/class/method/type/interface).
  const undefinedSymbols: string[] = [];
  for (const sym of symbols) {
    const defs = indexer.chunkStore
      .getByName(sym, 10)
      .filter(
        (c) =>
          c.name === sym &&
          ["function", "class", "method", "type", "interface", "module"].includes(c.type)
      );
    if (defs.length === 0) continue;
    const citedDef = defs.some((d) =>
      verify.some((v) => v.file && isSameFile(d, v, indexer))
    );
    if (!citedDef) undefinedSymbols.push(sym);
  }

  // 4. Doc-mention coverage. If any discussed symbol has doc mentions but
  //    none of the cited evidence points at a .md / .markdown file, the
  //    answer likely skipped documentation.
  const undocumentedSymbols: string[] = [];
  for (const sym of symbols) {
    const mentions = indexer.docEdgeStore.getBySymbol(sym, 5);
    if (mentions.length === 0) continue;
    const docCited = verify.some(
      (v) =>
        v.file &&
        (v.file.endsWith(".md") ||
          v.file.endsWith(".markdown") ||
          v.file.endsWith(".mdx"))
    );
    if (!docCited) undocumentedSymbols.push(sym);
  }

  return formatCritique({
    claim,
    verify,
    stale,
    moved,
    hubsCited,
    missedHubs,
    undefinedSymbols,
    undocumentedSymbols,
    totalSymbols: symbols.length,
  });
}

function isSameFile(
  chunk: { file_id: number },
  verified: VerifyResult,
  indexer: Indexer
): boolean {
  if (!verified.file) return false;
  const file = indexer.fileStore.getAll().find((f) => f.id === chunk.file_id);
  return file?.path === verified.file;
}

interface CritiqueData {
  claim: string | null;
  verify: VerifyResult[];
  stale: VerifyResult[];
  moved: VerifyResult[];
  hubsCited: string[];
  missedHubs: string[];
  undefinedSymbols: string[];
  undocumentedSymbols: string[];
  totalSymbols: number;
}

function formatCritique(c: CritiqueData): string {
  const parts: string[] = [];
  parts.push(
    c.claim
      ? `## sverklo_critique — "${c.claim}"`
      : "## sverklo_critique"
  );
  parts.push("");

  const verdicts: string[] = [];
  let verdict: "PASS" | "WARN" | "FAIL" = "PASS";
  if (c.stale.length > 0) verdict = "FAIL";
  else if (c.moved.length > 0 || c.missedHubs.length > 0 || c.undefinedSymbols.length > 0)
    verdict = "WARN";

  parts.push(`### Verdict: ${verdict}`);
  parts.push("");

  // Evidence health
  parts.push("### Evidence health");
  parts.push(
    `- verified: ${c.verify.filter((v) => v.status === "unchanged").length}`
  );
  if (c.moved.length > 0) parts.push(`- moved: ${c.moved.length} (review line numbers)`);
  if (c.stale.length > 0) {
    parts.push(`- **stale: ${c.stale.length}** — answer cites evidence that no longer matches:`);
    for (const s of c.stale.slice(0, 5)) {
      parts.push(`  - ${s.id} (${s.status})${s.file ? " at " + s.file : ""}`);
    }
  }
  parts.push("");

  // Hub coverage
  parts.push("### Structural coverage");
  if (c.hubsCited.length > 0) {
    parts.push(`- cited hubs: ${c.hubsCited.length}`);
  }
  if (c.missedHubs.length > 0) {
    parts.push(
      `- **missed hubs** (top PageRank files not cited): ${c.missedHubs.join(", ")}`
    );
    verdicts.push(
      "Likely incomplete — discussed ≥3 symbols but cited zero structurally-important files."
    );
  }
  parts.push("");

  // Symbol definitions
  if (c.totalSymbols > 0) {
    parts.push("### Symbol coverage");
    if (c.undefinedSymbols.length > 0) {
      parts.push(
        `- **missing definitions**: ${c.undefinedSymbols.join(", ")} (cited references but not the defining chunk)`
      );
    } else {
      parts.push(`- definitions cited for all ${c.totalSymbols} symbols`);
    }
    parts.push("");
  }

  // Doc coverage
  if (c.undocumentedSymbols.length > 0) {
    parts.push("### Doc coverage");
    parts.push(
      `- **doc mentions not acknowledged**: ${c.undocumentedSymbols.join(", ")} — these symbols are referenced in markdown but no docs were cited.`
    );
    parts.push("");
  }

  if (verdicts.length > 0) {
    parts.push("### Suggested follow-ups");
    for (const v of verdicts) parts.push(`- ${v}`);
  }

  return parts.join("\n").trimEnd();
}

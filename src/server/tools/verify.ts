import type { Indexer } from "../../indexer/indexer.js";
import { verifyEvidence } from "../../memory/evidence.js";
import type { VerifyResult } from "../../types/index.js";

export const verifyTool = {
  name: "sverklo_verify",
  description:
    "Check whether one or more evidence ids (from a prior search-family tool's " +
    "```evidence block) still point to the same code they did at retrieval time. " +
    "Returns unchanged / moved / modified / deleted / file_missing per id. Use " +
    "this to prevent hallucinated citations after code changes.",
  inputSchema: {
    type: "object" as const,
    properties: {
      evidence_ids: {
        type: "array",
        items: { type: "string" },
        description: "List of ev_xxxxxx ids to verify.",
      },
      claim: {
        type: "string",
        description:
          "Optional human-readable claim the ids support. Echoed back in the " +
          "header — useful for audit logs.",
      },
    },
    required: ["evidence_ids"],
  },
};

export function handleVerify(
  indexer: Indexer,
  args: Record<string, unknown>
): string {
  const ids = args.evidence_ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    return "sverklo_verify requires evidence_ids: string[].";
  }

  const results: VerifyResult[] = ids.map((id) =>
    typeof id === "string"
      ? verifyEvidence(indexer, id)
      : { id: String(id), status: "deleted", note: "non-string id" }
  );

  const claim = typeof args.claim === "string" ? args.claim : null;
  return formatVerify(results, claim);
}

function glyph(status: VerifyResult["status"]): string {
  switch (status) {
    case "unchanged":
      return "✓";
    case "moved":
      return "→";
    case "modified":
      return "⚠";
    case "deleted":
    case "file_missing":
      return "✗";
  }
}

function formatVerify(results: VerifyResult[], claim: string | null): string {
  const parts: string[] = [];
  const header = claim
    ? `## sverklo_verify — ${results.length} evidence id(s) for "${claim}"`
    : `## sverklo_verify — ${results.length} evidence id(s)`;
  parts.push(header);
  parts.push("");
  for (const r of results) {
    const g = glyph(r.status);
    const loc =
      r.current_lines && r.file
        ? `${r.file}:${r.current_lines[0]}-${r.current_lines[1]}`
        : r.file ?? "(unknown file)";
    const simTag = r.similarity !== undefined ? ` (sim ${r.similarity})` : "";
    const noteTag = r.note ? ` — ${r.note}` : "";
    parts.push(`${g} ${r.id}  ${loc}  [${r.status}]${simTag}${noteTag}`);
  }

  const counts = {
    unchanged: 0, moved: 0, modified: 0, deleted: 0, file_missing: 0,
  };
  for (const r of results) counts[r.status]++;
  parts.push("");
  const summary = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${k}`)
    .join(" · ");
  parts.push(`_${summary}_`);
  return parts.join("\n");
}

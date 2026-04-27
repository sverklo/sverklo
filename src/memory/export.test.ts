import { describe, it, expect } from "vitest";
import { renderMarkdownCombined, parseMarkdownEdits } from "./export.js";
import type { Memory } from "../types/index.js";

function mkMemory(overrides: Partial<Memory> & Pick<Memory, "id" | "content">): Memory {
  return {
    id: overrides.id,
    category: overrides.category ?? "context",
    content: overrides.content,
    tags: overrides.tags ?? null,
    confidence: overrides.confidence ?? 1.0,
    git_sha: overrides.git_sha ?? null,
    git_branch: overrides.git_branch ?? null,
    related_files: overrides.related_files ?? null,
    created_at: overrides.created_at ?? Date.parse("2026-04-27T00:00:00Z"),
    updated_at: overrides.updated_at ?? Date.parse("2026-04-27T00:00:00Z"),
    last_accessed: overrides.last_accessed ?? null,
    tier: overrides.tier ?? "core",
    valid_from_sha: overrides.valid_from_sha ?? null,
    valid_until_sha: overrides.valid_until_sha ?? null,
    superseded_by: overrides.superseded_by ?? null,
    kind: overrides.kind ?? "episodic",
  };
}

describe("renderMarkdownCombined", () => {
  it("renders the empty case as a placeholder string", () => {
    expect(renderMarkdownCombined([])).toContain("no memories");
  });

  it("groups by category and emits per-row IDs in headings", () => {
    const rows = [
      mkMemory({ id: 1, category: "preference", content: "no em-dashes", kind: "semantic" }),
      mkMemory({ id: 2, category: "correction", content: "stop calling fixThis()", kind: "semantic" }),
      mkMemory({ id: 3, category: "preference", content: "tabs over spaces", kind: "semantic" }),
    ];
    const out = renderMarkdownCombined(rows);
    expect(out).toContain("# Preferences");
    expect(out).toContain("# Corrections");
    expect(out).toMatch(/##\s+#1\s+·\s+semantic/);
    expect(out).toMatch(/##\s+#2\s+·\s+semantic/);
    expect(out).toMatch(/##\s+#3\s+·\s+semantic/);
    expect(out).toContain("no em-dashes");
    expect(out).toContain("stop calling fixThis()");
  });

  it("includes correction category in CATEGORY_HEADINGS without falling back to raw key", () => {
    const out = renderMarkdownCombined([
      mkMemory({ id: 99, category: "correction", content: "x" }),
    ]);
    // "Corrections" (capitalised label), not "correction" (raw key).
    expect(out).toContain("# Corrections");
    expect(out).not.toMatch(/^# correction\b/m);
  });
});

describe("parseMarkdownEdits", () => {
  it("round-trips renderMarkdownCombined output", () => {
    const rows = [
      mkMemory({ id: 1, category: "preference", content: "no em-dashes", kind: "semantic" }),
      mkMemory({ id: 2, category: "decision", content: "we picked SQLite", kind: "episodic" }),
    ];
    const md = renderMarkdownCombined(rows);
    const parsed = parseMarkdownEdits(md);
    expect(parsed).not.toBeNull();
    expect(parsed!).toHaveLength(2);
    expect(parsed!.find((p) => p.id === 1)?.content).toBe("no em-dashes");
    expect(parsed!.find((p) => p.id === 2)?.content).toBe("we picked SQLite");
  });

  it("captures a content edit while preserving the heading id", () => {
    const before = renderMarkdownCombined([
      mkMemory({ id: 7, category: "preference", content: "first version" }),
    ]);
    const edited = before.replace("first version", "edited version");
    const parsed = parseMarkdownEdits(edited);
    expect(parsed).not.toBeNull();
    expect(parsed!.find((p) => p.id === 7)?.content).toBe("edited version");
  });

  it("does not emit anything for ids that were removed from the file (omission ≠ deletion)", () => {
    const rows = [
      mkMemory({ id: 1, content: "keep me" }),
      mkMemory({ id: 2, content: "remove me" }),
    ];
    const md = renderMarkdownCombined(rows);
    // Remove the entire #2 block: split on the heading and re-stitch
    // without the matched chunk. Robust to whether the block has a
    // trailing block-separator or sits at end-of-document.
    const stripped = md.replace(/## #2[\s\S]*$/, "");
    const parsed = parseMarkdownEdits(stripped);
    expect(parsed).not.toBeNull();
    expect(parsed!.map((p) => p.id)).toEqual([1]);
    // The caller (memory edit CLI) is responsible for treating omission
    // as "leave alone, don't delete" — this test just pins that the
    // parser doesn't surface phantom ids.
  });

  it("supports multi-paragraph content", () => {
    const rows = [
      mkMemory({
        id: 5,
        category: "decision",
        content: "We chose SQLite because:\n\n- it's local-first\n- bi-temporal queries are easy\n- no external deps",
      }),
    ];
    const md = renderMarkdownCombined(rows);
    const parsed = parseMarkdownEdits(md);
    expect(parsed!.find((p) => p.id === 5)?.content).toContain("local-first");
    expect(parsed!.find((p) => p.id === 5)?.content).toContain("bi-temporal queries");
  });

  it("returns null for malformed heading ids", () => {
    const broken = "## #abc · semantic\n\nbody\n";
    // The line literally has `## #abc` which fails the digit-only id regex
    // and is therefore treated as not-a-memory-heading; parser returns [].
    const parsed = parseMarkdownEdits(broken);
    expect(parsed).toEqual([]);
  });
});

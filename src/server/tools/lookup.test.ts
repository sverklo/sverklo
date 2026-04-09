import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Indexer } from "../../indexer/indexer.js";
import { getProjectConfig } from "../../utils/config.js";
import { handleLookup } from "./lookup.js";

// Regression tests for github.com/sverklo/sverklo/issues/15.
//
// Two bugs combined to silently lie about whether a symbol existed:
//
//  A. Missing-required-parameter fallthrough. Calling the tool with
//     the wrong param name (or no param) went straight to a SQL
//     LIKE '%undefined%' which matches nothing, returning "No results
//     found" — indistinguishable from "the symbol does not exist."
//
//  B. Oversize-chunk silent drop. When a query matched both a small
//     chunk (fits the budget) and a big one (doesn't), the big one
//     was silently dropped. The user saw the small match and
//     concluded the big one didn't exist. On a realistic codebase
//     looking up a major class, this made the tool useless — the
//     real class body is always the biggest match.

describe("handleLookup — issue #15 regression", () => {
  let tmpRoot: string;
  let indexer: Indexer;

  beforeEach(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "sverklo-lookup-"));
    mkdirSync(join(tmpRoot, "src"), { recursive: true });
    mkdirSync(join(tmpRoot, "test"), { recursive: true });

    // A "big" class that exceeds the default token budget (1200).
    // We pad the body with enough meaningful-looking code to push the
    // chunk's estimated token count well above 1200.
    const padLines = Array.from(
      { length: 200 },
      (_, i) => `  method${i}(): void { return; }`
    ).join("\n");
    writeFileSync(
      join(tmpRoot, "src", "indexer.ts"),
      ["export class Indexer {", padLines, "}"].join("\n"),
      "utf-8"
    );

    // A "small" function that matches the same substring but fits
    // the budget. Without the fix, this would hide the Indexer class.
    writeFileSync(
      join(tmpRoot, "test", "fakes.ts"),
      "export function fakeIndexerWithCore() { return {}; }\n",
      "utf-8"
    );

    const cfg = getProjectConfig(tmpRoot);
    indexer = new Indexer(cfg);
    await indexer.index();
  });

  afterEach(() => {
    try {
      indexer.close();
    } catch {}
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  });

  // ── Bug A ─────────────────────────────────────────────────────

  it("returns a helpful error when `symbol` is missing (bug A)", () => {
    const out = handleLookup(indexer, {});
    expect(out).toContain("Error");
    expect(out).toContain("symbol");
    // The error should specifically mention the common typo so
    // users don't have to read the schema.
    expect(out).toMatch(/name.*typo|symbol.*not.*name/i);
  });

  it("returns a helpful error when `symbol` is an empty string (bug A)", () => {
    const out = handleLookup(indexer, { symbol: "" });
    expect(out).toContain("Error");
  });

  it("returns a helpful error when the wrong parameter name is used (bug A)", () => {
    // Users commonly call this with `name: "Foo"` instead of
    // `symbol: "Foo"`. Before the fix, that silently returned
    // "No results found" — indistinguishable from a real miss.
    const out = handleLookup(indexer, { name: "Indexer" });
    expect(out).toContain("Error");
    expect(out).toMatch(/name.*typo|symbol.*not.*name/i);
  });

  // ── Bug B ─────────────────────────────────────────────────────

  it("surfaces oversize matches as locations, even when smaller matches fit (bug B)", () => {
    // `Indexer` matches both: the big class (oversized) and the small
    // fakeIndexerWithCore (fits). Before the fix, only the small one
    // was shown and the big one was silently dropped.
    const out = handleLookup(indexer, { symbol: "Indexer", token_budget: 1200 });

    // The small match should be visible
    expect(out).toContain("fakeIndexerWithCore");
    // And the big match should ALSO be visible, at minimum as a
    // locations-only entry pointing at indexer.ts.
    expect(out).toContain("indexer.ts");
    expect(out).toMatch(/class: Indexer|Indexer/);
    // The "too large" explanation should be present so the caller
    // knows the body was skipped on purpose, not missing.
    expect(out).toMatch(/too large|exceed|token_budget/i);
  });

  it("surfaces all matches as locations when none fit", () => {
    // With a tiny budget, nothing fits — but we still need the
    // locations list, not "No results found."
    const out = handleLookup(indexer, { symbol: "Indexer", token_budget: 80 });
    expect(out).not.toBe("No results found.");
    expect(out).toMatch(/exceed|token_budget|locations only/i);
    expect(out).toContain("indexer.ts");
  });

  it("with a large budget, returns full bodies for both matches", () => {
    const out = handleLookup(indexer, { symbol: "Indexer", token_budget: 20000 });
    expect(out).toContain("fakeIndexerWithCore");
    expect(out).toContain("class Indexer");
    // With full bodies rendered, the "too large" warning should not
    // appear.
    expect(out).not.toMatch(/too large/i);
  });

  it("still returns 'No results found' when the symbol genuinely does not exist", () => {
    const out = handleLookup(indexer, { symbol: "NonexistentSymbolXYZ" });
    expect(out).toBe("No results found.");
  });
});

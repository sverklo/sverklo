import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Indexer } from "../../indexer/indexer.js";
import { getProjectConfig } from "../../utils/config.js";
import { handleFindReferences } from "./find-references.js";

// Regression tests for github.com/sverklo/sverklo/issues/14.
//
// sverklo_refs used to substring-match the symbol name, so a query
// for `embed` returned 48 hits that were mostly `embeddingStore`,
// `embeddingBatch`, `EmbeddingStore` class, etc. — dozens of false
// positives drowning the 5 real call sites.
//
// The fix: word-boundary matching by default, substring opt-in via
// `exact: false`.

describe("handleFindReferences — issue #14 regression", () => {
  let tmpRoot: string;
  let indexer: Indexer;

  beforeEach(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "sverklo-refs-"));
    mkdirSync(join(tmpRoot, "src"), { recursive: true });

    // Seed a codebase that reproduces the original noise pattern:
    // one real identifier `embed` plus several longer identifiers
    // that contain `embed` as a substring. The exact-match mode
    // should return only the real ones.
    writeFileSync(
      join(tmpRoot, "src", "indexer.ts"),
      [
        "export class Indexer {",
        "  public embeddingStore: unknown;",
        "  public embeddingBatch: unknown[] = [];",
        "  async run() {",
        "    const vectors = await embed(['text']);",
        "    this.embeddingStore = vectors;",
        "    this.embeddingBatch.push(...vectors);",
        "    return embed(['another']);",
        "  }",
        "}",
        "declare function embed(texts: string[]): Promise<unknown>;",
      ].join("\n"),
      "utf-8"
    );

    writeFileSync(
      join(tmpRoot, "src", "storage.ts"),
      [
        "export class EmbeddingStore {",
        "  // stores vectors produced by the indexer",
        "  save() {}",
        "}",
      ].join("\n"),
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

  it("default exact mode matches whole identifiers only", () => {
    const out = handleFindReferences(indexer, { symbol: "embed" });
    // The two real calls to embed() must appear
    expect(out).toContain("await embed(['text'])");
    expect(out).toContain("embed(['another'])");
    // But `embeddingStore`, `embeddingBatch`, `EmbeddingStore` must NOT
    // be reported as references to `embed`
    expect(out).not.toContain("embeddingStore: unknown");
    expect(out).not.toContain("embeddingBatch.push");
    expect(out).not.toContain("class EmbeddingStore");
  });

  it("exact: false opts into substring behavior for edge cases", () => {
    const out = handleFindReferences(indexer, { symbol: "embed", exact: false });
    // In substring mode, the longer names do match
    expect(out).toContain("embeddingStore");
    // And the real calls are still there
    expect(out).toContain("embed(['text'])");
  });

  it("rejects missing symbol with a clear error", () => {
    const out = handleFindReferences(indexer, {});
    expect(out).toContain("Error");
    expect(out).toContain("symbol");
  });

  it("does not match inside longer identifiers that share a prefix", () => {
    // `Embedding` has `embed` as a prefix but should not match
    // in exact mode.
    const out = handleFindReferences(indexer, { symbol: "embed" });
    expect(out).not.toContain("EmbeddingStore");
  });

  it("matches exact identifier even when it contains regex metachars", () => {
    // Names with dots / dollar signs / brackets must not break the
    // regex builder.
    const out = handleFindReferences(indexer, { symbol: "$invalid" });
    // Should return "No references" for a non-existent symbol, not
    // throw on regex construction.
    expect(out).toContain("No references found");
  });
});

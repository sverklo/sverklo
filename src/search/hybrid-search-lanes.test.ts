import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Indexer } from "../indexer/indexer.js";
import { getProjectConfig } from "../utils/config.js";
import { hybridSearchWithConfidence } from "./hybrid-search.js";

// Regression test for v0.25.0 #61 (retrieval-lane observability).
//
// Pre-v0.25.0, the hybridSearch pipeline computed BM25 + vector + RRF
// internally but threw away per-lane attribution. Search responses
// hardcoded `method: "fts"` in their evidence rows and gave users no
// way to tell whether the vector lane had contributed. Combined with
// #59 (silent provider fallback) and #60 (49% coverage), this made
// retrieval health invisible.
//
// v0.25.0 added HybridLaneStats and surfaced it as
// HybridSearchResult.lanes. This test would FAIL on v0.23.1 because
// the lanes field didn't exist.

describe("hybridSearchWithConfidence — #61 lane attribution", () => {
  let tmpRoot: string;
  let indexer: Indexer;

  beforeEach(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "sverklo-lanes-"));
    mkdirSync(join(tmpRoot, "src"), { recursive: true });
    // Two files so RRF has more than one chunk to fuse over.
    writeFileSync(
      join(tmpRoot, "src", "auth.ts"),
      "export function authenticate(token: string) { return token.length > 0; }\n",
      "utf-8"
    );
    writeFileSync(
      join(tmpRoot, "src", "users.ts"),
      "export function findUser(id: number) { return { id, name: 'test' }; }\n",
      "utf-8"
    );
    const cfg = getProjectConfig(tmpRoot);
    indexer = new Indexer(cfg);
    await indexer.index();
  });

  afterEach(() => {
    try { indexer.close(); } catch {}
    try { rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  });

  it("response includes `lanes` with the documented shape", async () => {
    const response = await hybridSearchWithConfidence(indexer, {
      query: "authenticate",
      tokenBudget: 1000,
    });
    // Pre-v0.25.0, this property didn't exist.
    expect(response).toHaveProperty("lanes");
    const lanes = response.lanes!;
    expect(lanes).toHaveProperty("candidatePool");
    expect(lanes).toHaveProperty("ftsHits");
    expect(lanes).toHaveProperty("vectorHits");
    expect(lanes).toHaveProperty("bothLanes");
    expect(lanes).toHaveProperty("vectorPoolScanned");
    expect(lanes).toHaveProperty("vectorPoolEmpty");
  });

  it("lane counters are non-negative and bothLanes ≤ min(ftsHits, vectorHits)", async () => {
    const response = await hybridSearchWithConfidence(indexer, {
      query: "authenticate",
      tokenBudget: 1000,
    });
    const lanes = response.lanes!;
    expect(lanes.candidatePool).toBeGreaterThanOrEqual(0);
    expect(lanes.ftsHits).toBeGreaterThanOrEqual(0);
    expect(lanes.vectorHits).toBeGreaterThanOrEqual(0);
    expect(lanes.bothLanes).toBeGreaterThanOrEqual(0);
    expect(lanes.vectorPoolScanned).toBeGreaterThanOrEqual(0);
    expect(lanes.vectorPoolEmpty).toBeGreaterThanOrEqual(0);
    // The overlap can't exceed either lane's hit count.
    expect(lanes.bothLanes).toBeLessThanOrEqual(lanes.ftsHits);
    expect(lanes.bothLanes).toBeLessThanOrEqual(lanes.vectorHits);
  });

  it("BM25 lane returns hits for an exact-text query", async () => {
    const response = await hybridSearchWithConfidence(indexer, {
      query: "authenticate",
      tokenBudget: 1000,
    });
    // The query exactly matches a symbol in auth.ts — BM25 should
    // pick it up regardless of vector-lane health.
    expect(response.lanes!.ftsHits).toBeGreaterThan(0);
  });
});

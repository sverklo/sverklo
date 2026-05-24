import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Indexer } from "./indexer.js";
import { getProjectConfig } from "../utils/config.js";
import {
  createDatabase,
  getStoredFingerprint,
  setStoredFingerprint,
} from "../storage/database.js";

// Issue #69: provider-change auto-detect.
//
// Before this patch, `fingerprintOf()` existed in embedding-providers.ts
// but was only ever called by its own unit test. Switching providers in
// `.sverklo.yaml` (e.g. onnx -> ollama, or one ollama model -> another)
// silently mixed vector spaces inside the same embeddings table — the
// indexer carried on with the new provider on top of the old vectors,
// degrading search quality with no visible signal.
//
// The fix wires three things together:
//   1. Storage helpers `getStoredFingerprint` / `setStoredFingerprint`
//      reading/writing the `meta` table key 'embedding_fingerprint'.
//   2. `Indexer.index()` reads the stored fingerprint before any writes
//      and refuses to update if it disagrees with the active provider.
//      It also stamps the current fingerprint when there's no stored
//      one (first index, legacy upgrade).
//   3. `sverklo doctor` surfaces the disagreement as a check-fail with
//      `sverklo reindex --force` as the fix.
//
// Each test below was verified to FAIL on the unpatched code by
// stashing the wiring and re-running (see CHANGELOG entry).

describe("storage fingerprint helpers", () => {
  it("returns null on a fresh database with no stored fingerprint", () => {
    const db = createDatabase(":memory:");
    expect(getStoredFingerprint(db)).toBeNull();
    db.close();
  });

  it("round-trips through the meta table", () => {
    const db = createDatabase(":memory:");
    setStoredFingerprint(db, { provider: "ollama:nomic-embed-text", dimensions: 768 });
    expect(getStoredFingerprint(db)).toEqual({
      provider: "ollama:nomic-embed-text",
      dimensions: 768,
    });
    db.close();
  });

  it("overwrites on second set (ON CONFLICT)", () => {
    const db = createDatabase(":memory:");
    setStoredFingerprint(db, { provider: "default", dimensions: 384 });
    setStoredFingerprint(db, { provider: "openai:text-embedding-3-small", dimensions: 1536 });
    expect(getStoredFingerprint(db)).toEqual({
      provider: "openai:text-embedding-3-small",
      dimensions: 1536,
    });
    db.close();
  });

  it("returns null when stored JSON is malformed", () => {
    const db = createDatabase(":memory:");
    // Bypass setStoredFingerprint to inject garbage. Mirrors what a
    // partial-write or downgrade-then-upgrade sequence might leave.
    db.prepare(
      "INSERT INTO meta (key, value) VALUES ('embedding_fingerprint', 'not-json')"
    ).run();
    expect(getStoredFingerprint(db)).toBeNull();
    db.close();
  });

  it("returns null when stored JSON has wrong shape", () => {
    const db = createDatabase(":memory:");
    db.prepare(
      "INSERT INTO meta (key, value) VALUES ('embedding_fingerprint', ?)"
    ).run(JSON.stringify({ provider: "ollama" })); // missing dimensions
    expect(getStoredFingerprint(db)).toBeNull();
    db.close();
  });
});

describe("Indexer fingerprint wiring (issue #69)", () => {
  let tmpRoot: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "sverklo-fingerprint-"));
    mkdirSync(join(tmpRoot, "src"), { recursive: true });
    writeFileSync(
      join(tmpRoot, "src", "a.ts"),
      "export function hello() { return 'world'; }\n",
      "utf-8"
    );
  });

  afterEach(() => {
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SVERKLO_") && !(key in originalEnv)) {
        delete process.env[key];
      }
    }
    for (const [k, v] of Object.entries(originalEnv)) {
      if (k.startsWith("SVERKLO_")) process.env[k] = v;
    }
  });

  it("stamps the fingerprint after the first successful index", async () => {
    delete process.env.SVERKLO_EMBEDDING_PROVIDER;
    const cfg = getProjectConfig(tmpRoot);

    const indexer = new Indexer(cfg);
    try {
      await indexer.index();
    } finally {
      indexer.close();
    }

    // Reopen the DB read-only and confirm the fingerprint row exists.
    const db = createDatabase(cfg.dbPath);
    try {
      const fp = getStoredFingerprint(db);
      expect(fp).not.toBeNull();
      expect(fp!.provider).toBe("default");
      expect(fp!.dimensions).toBe(384);
    } finally {
      db.close();
    }
  });

  // Core regression: this is the failure mode #69 was filed for.
  // Without the wiring, the second index() call silently succeeds and
  // mixes 384d vectors with 1024d vectors in the same embeddings table.
  it("refuses to update when the stored fingerprint disagrees with the current provider", async () => {
    delete process.env.SVERKLO_EMBEDDING_PROVIDER;
    delete process.env.SVERKLO_OLLAMA_URL;

    const cfg = getProjectConfig(tmpRoot);

    // First index: default ONNX, 384d.
    const first = new Indexer(cfg);
    try {
      await first.index();
    } finally {
      first.close();
    }

    // Confirm the first run stamped a fingerprint.
    {
      const db = createDatabase(cfg.dbPath);
      try {
        expect(getStoredFingerprint(db)).toEqual({
          provider: "default",
          dimensions: 384,
        });
      } finally {
        db.close();
      }
    }

    // Now switch the config to Ollama at 1024d. Mock fetch so the
    // factory init() succeeds and reports a 1024-dim provider.
    writeFileSync(
      join(tmpRoot, ".sverklo.yaml"),
      [
        "embeddings:",
        "  provider: ollama",
        "  dimensions: 1024",
        "  ollama:",
        "    baseUrl: http://localhost:11434",
        "    model: qwen3-embedding:0.6b",
        "",
      ].join("\n"),
      "utf-8"
    );

    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url: unknown, init?: unknown) => {
      const u = String(url);
      if (u.endsWith("/api/tags")) {
        return new Response(JSON.stringify({ models: [] }), { status: 200 });
      }
      if (u.endsWith("/api/embed")) {
        const body = JSON.parse((init as { body: string }).body);
        const input: string[] = Array.isArray(body.input) ? body.input : [body.input];
        return new Response(
          JSON.stringify({
            embeddings: input.map(() => new Array(1024).fill(0)),
          }),
          { status: 200 }
        );
      }
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const second = new Indexer(cfg);
      try {
        await expect(second.index()).rejects.toThrow(
          /Embedding provider change detected/
        );
        // Error message must mention both fingerprints and the fix.
        await expect(second.index()).rejects.toThrow(/default \(384d\)/);
        await expect(second.index()).rejects.toThrow(/ollama.*\(1024d\)/);
        await expect(second.index()).rejects.toThrow(/sverklo reindex --force/);
      } finally {
        second.close();
      }
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("succeeds on the path: index -> clearIndex -> index (rebuild with new provider)", async () => {
    delete process.env.SVERKLO_EMBEDDING_PROVIDER;
    delete process.env.SVERKLO_OLLAMA_URL;

    const cfg = getProjectConfig(tmpRoot);

    // First index: default ONNX, 384d. Stamps fingerprint.
    const first = new Indexer(cfg);
    try {
      await first.index();
    } finally {
      first.close();
    }

    // Switch config to Ollama 1024d.
    writeFileSync(
      join(tmpRoot, ".sverklo.yaml"),
      [
        "embeddings:",
        "  provider: ollama",
        "  dimensions: 1024",
        "  ollama:",
        "    baseUrl: http://localhost:11434",
        "    model: qwen3-embedding:0.6b",
        "",
      ].join("\n"),
      "utf-8"
    );

    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url: unknown, init?: unknown) => {
      const u = String(url);
      if (u.endsWith("/api/tags")) {
        return new Response(JSON.stringify({ models: [] }), { status: 200 });
      }
      if (u.endsWith("/api/embed")) {
        const body = JSON.parse((init as { body: string }).body);
        const input: string[] = Array.isArray(body.input) ? body.input : [body.input];
        return new Response(
          JSON.stringify({
            embeddings: input.map(() => new Array(1024).fill(0)),
          }),
          { status: 200 }
        );
      }
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const second = new Indexer(cfg);
      try {
        // The expected user workflow: refusal, then reindex --force,
        // which calls clearIndex() then index() fresh.
        const cleared = second.clearIndex();
        expect(cleared.failed).toHaveLength(0);
        // After clearIndex the DB file is gone (and reinitialized
        // empty), so no stored fingerprint. Second index() runs to
        // completion and stamps the new fingerprint.
        await second.index();
        expect(second.embeddingProviderName).toContain("ollama");
        expect(second.embeddingDimensions).toBe(1024);
      } finally {
        second.close();
      }
    } finally {
      global.fetch = originalFetch;
    }

    // Re-open and confirm the stamped fingerprint reflects the new provider.
    const db = createDatabase(cfg.dbPath);
    try {
      const fp = getStoredFingerprint(db);
      expect(fp).not.toBeNull();
      expect(fp!.provider).toMatch(/^ollama:/);
      expect(fp!.dimensions).toBe(1024);
    } finally {
      db.close();
    }
  });

  it("legacy upgrade: stamps fingerprint on first index against a pre-#69 db with no stored fingerprint", async () => {
    delete process.env.SVERKLO_EMBEDDING_PROVIDER;
    const cfg = getProjectConfig(tmpRoot);

    // Simulate a pre-#69 database: create the DB and write some
    // synthetic embeddings (no fingerprint row).
    const seed = createDatabase(cfg.dbPath);
    // No setStoredFingerprint call. Just confirm the helper sees null.
    expect(getStoredFingerprint(seed)).toBeNull();
    seed.close();

    // Now run a normal index against that DB. Should NOT throw —
    // there's nothing to compare against — and SHOULD stamp the
    // current fingerprint for next run's benefit.
    const indexer = new Indexer(cfg);
    try {
      await indexer.index();
    } finally {
      indexer.close();
    }

    const db = createDatabase(cfg.dbPath);
    try {
      expect(getStoredFingerprint(db)).toEqual({
        provider: "default",
        dimensions: 384,
      });
    } finally {
      db.close();
    }
  });
});

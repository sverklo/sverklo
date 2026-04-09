import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Indexer } from "./indexer.js";
import { getProjectConfig } from "../utils/config.js";

// Integration test that would have caught the issue #9 wiring gap:
// the provider factory existed and its unit tests passed, but the
// Indexer never actually called the factory — it imported legacyEmbed
// directly from ./embedder.js and used it everywhere. Users setting
// SVERKLO_EMBEDDING_PROVIDER=openai silently got the bundled ONNX
// model and no visible error.
//
// The fix was to lazily initialize the provider on the first index()
// call and expose it via `indexer.embed()` / `indexer.embeddingProviderName`.
// These tests lock that wiring in so a refactor can't silently break
// it again.
//
// We don't hit real OpenAI / Ollama endpoints here. The point isn't
// to prove the providers work (their own unit tests do that). The
// point is to prove the indexer *uses* whichever provider the env
// vars selected, instead of always defaulting.

describe("Indexer + embedding provider integration", () => {
  let tmpRoot: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "sverklo-provider-int-"));
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
    // Restore env so tests don't leak into each other.
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SVERKLO_") && !(key in originalEnv)) {
        delete process.env[key];
      }
    }
    for (const [k, v] of Object.entries(originalEnv)) {
      if (k.startsWith("SVERKLO_")) process.env[k] = v;
    }
  });

  it("defaults to the bundled provider when no env var is set", async () => {
    delete process.env.SVERKLO_EMBEDDING_PROVIDER;

    const indexer = new Indexer(getProjectConfig(tmpRoot));
    try {
      await indexer.index();
      expect(indexer.embeddingProviderName).toBe("default");
      expect(indexer.embeddingDimensions).toBe(384);
    } finally {
      indexer.close();
    }
  });

  it("selects the OpenAI provider when SVERKLO_EMBEDDING_PROVIDER=openai and key is set", async () => {
    // We can't actually call OpenAI in a test — patch fetch to a
    // deterministic stub so the provider init succeeds. The indexer
    // then commits to the openai provider for the rest of its life.
    process.env.SVERKLO_EMBEDDING_PROVIDER = "openai";
    process.env.SVERKLO_OPENAI_API_KEY = "sk-test";

    // Mock fetch so the embedder calls look successful and return
    // the right number of dimensions per request.
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (_url: unknown, init?: unknown) => {
      const body = JSON.parse((init as { body: string }).body);
      const input: string[] = Array.isArray(body.input) ? body.input : [body.input];
      return new Response(
        JSON.stringify({
          data: input.map((_, i) => ({
            index: i,
            embedding: new Array(1536).fill(0),
          })),
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    try {
      const indexer = new Indexer(getProjectConfig(tmpRoot));
      try {
        await indexer.index();
        expect(indexer.embeddingProviderName).toContain("openai");
        expect(indexer.embeddingDimensions).toBe(1536);
      } finally {
        indexer.close();
      }
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("falls back to default when OpenAI is requested but the API key is missing", async () => {
    process.env.SVERKLO_EMBEDDING_PROVIDER = "openai";
    delete process.env.SVERKLO_OPENAI_API_KEY;

    const indexer = new Indexer(getProjectConfig(tmpRoot));
    try {
      await indexer.index();
      // Factory init() throws on missing key → factory falls back to
      // default. The whole point of the wiring is that this fallback
      // is visible, not silent.
      expect(indexer.embeddingProviderName).toBe("default");
    } finally {
      indexer.close();
    }
  });

  it("initializes the provider lazily on first embed() if index() hasn't run yet", async () => {
    delete process.env.SVERKLO_EMBEDDING_PROVIDER;

    const indexer = new Indexer(getProjectConfig(tmpRoot));
    try {
      // Call embed() without first calling index(). The embed method
      // should fall back to the legacy path and still return vectors
      // — this covers agents that hit search/recall before the first
      // index cycle completes.
      const vecs = await indexer.embed(["hello world"]);
      expect(Array.isArray(vecs)).toBe(true);
      expect(vecs.length).toBe(1);
      expect(vecs[0]).toBeInstanceOf(Float32Array);
    } finally {
      indexer.close();
    }
  });

  it("reuses the same provider across multiple index() calls", async () => {
    delete process.env.SVERKLO_EMBEDDING_PROVIDER;

    const indexer = new Indexer(getProjectConfig(tmpRoot));
    try {
      await indexer.index();
      const firstName = indexer.embeddingProviderName;

      // Write a new file and reindex
      writeFileSync(
        join(tmpRoot, "src", "b.ts"),
        "export function goodbye() { return 'world'; }\n",
        "utf-8"
      );
      await indexer.index();

      // Provider identity stays stable — reindex should not reselect.
      expect(indexer.embeddingProviderName).toBe(firstName);
    } finally {
      indexer.close();
    }
  });
});

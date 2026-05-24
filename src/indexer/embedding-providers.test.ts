import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createEmbeddingProvider, fingerprintOf } from "./embedding-providers.js";

// We mock the underlying embedder module so tests don't try to load
// the real ONNX runtime or download the model.
vi.mock("./embedder.js", () => ({
  initEmbedder: vi.fn(async () => {}),
  embed: vi.fn(async (texts: string[]) => texts.map(() => new Float32Array(384))),
}));

describe("createEmbeddingProvider", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("defaults to the bundled ONNX provider when no env var is set", async () => {
    const p = await createEmbeddingProvider({});
    expect(p.name).toBe("default");
    expect(p.dimensions).toBe(384);
  });

  it("accepts provider aliases (bundled, onnx)", async () => {
    const p1 = await createEmbeddingProvider({ SVERKLO_EMBEDDING_PROVIDER: "bundled" });
    const p2 = await createEmbeddingProvider({ SVERKLO_EMBEDDING_PROVIDER: "onnx" });
    expect(p1.name).toBe("default");
    expect(p2.name).toBe("default");
  });

  it("creates an OpenAI provider when requested and API key is set", async () => {
    const p = await createEmbeddingProvider({
      SVERKLO_EMBEDDING_PROVIDER: "openai",
      SVERKLO_OPENAI_API_KEY: "sk-test",
    });
    expect(p.name).toContain("openai");
    expect(p.dimensions).toBe(1536);
  });

  it("falls back to default when OpenAI is requested without an API key", async () => {
    const p = await createEmbeddingProvider({
      SVERKLO_EMBEDDING_PROVIDER: "openai",
    });
    // Init throws on missing key → factory falls back to default.
    expect(p.name).toBe("default");
  });

  it("respects SVERKLO_OPENAI_DIMENSIONS override", async () => {
    const p = await createEmbeddingProvider({
      SVERKLO_EMBEDDING_PROVIDER: "openai",
      SVERKLO_OPENAI_API_KEY: "sk-test",
      SVERKLO_OPENAI_DIMENSIONS: "512",
    });
    expect(p.dimensions).toBe(512);
  });

  it("creates an Ollama provider when the endpoint probe succeeds", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ embedding: new Array(768).fill(0) }), { status: 200 })
    ) as unknown as typeof fetch;

    const p = await createEmbeddingProvider({
      SVERKLO_EMBEDDING_PROVIDER: "ollama",
    });
    expect(p.name).toContain("ollama");
    expect(p.dimensions).toBe(768);
  });

  it("falls back to default when Ollama is unreachable", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    const p = await createEmbeddingProvider({
      SVERKLO_EMBEDDING_PROVIDER: "ollama",
    });
    expect(p.name).toBe("default");
  });

  it("falls back to default for unknown provider names", async () => {
    const p = await createEmbeddingProvider({
      SVERKLO_EMBEDDING_PROVIDER: "magic-ai",
    });
    expect(p.name).toBe("default");
  });
});

describe("fingerprintOf", () => {
  it("captures provider name and dimensions", async () => {
    const p = await createEmbeddingProvider({});
    const fp = fingerprintOf(p);
    expect(fp.provider).toBe("default");
    expect(fp.dimensions).toBe(384);
  });
});

// Regression: issue #66. v0.25.0 fixed the YAML wiring so the Ollama
// provider was actually *selected*, but the provider trusted the
// configured `embeddings.dimensions` blindly and never compared it to
// the actual response length. Users running a model whose true output
// dim disagreed with their config (e.g. configured 1024, model returns
// 384) ended up with 384-dim vectors stored in the index while
// `provider.dimensions` kept reporting 1024. `sverklo doctor` flagged
// the mismatch but the embed phase wrote the bad data first.
//
// The fix: on every embed() batch, if the configured dim is known and
// the actual response dim disagrees, throw fail-loud. Better to abort
// the index run than to persist vectors that misrepresent themselves.
describe("OllamaProvider dimension validation (issue #66)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws when Ollama returns vectors with a different dim than configured", async () => {
    // Mock fetch: probe (/api/tags) succeeds, /api/embed returns 384-dim
    // vectors despite the caller having configured 1024. This is the
    // exact shape of Viraj's v0.25.1 failure.
    global.fetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.endsWith("/api/tags")) {
        return new Response(JSON.stringify({ models: [] }), { status: 200 });
      }
      if (u.endsWith("/api/embed")) {
        return new Response(
          JSON.stringify({ embeddings: [new Array(384).fill(0)] }),
          { status: 200 }
        );
      }
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    const p = await createEmbeddingProvider(
      { SVERKLO_EMBEDDING_PROVIDER: "ollama" },
      {
        embeddings: {
          provider: "ollama",
          dimensions: 1024,
          ollama: { baseUrl: "http://localhost:11434", model: "qwen3-embedding:0.6b" },
        },
      } as Parameters<typeof createEmbeddingProvider>[1]
    );

    // Factory should have selected ollama (not silently fallen back).
    expect(p.name).toContain("ollama");
    expect(p.dimensions).toBe(1024);

    // The actual write path: provider.embed() must refuse rather than
    // hand back 384-dim vectors that the indexer would persist.
    await expect(p.embed(["hello world"])).rejects.toThrow(
      /returned 384-dim vectors but the provider was configured for 1024-dim/
    );
  });

  it("auto-detects dimensions when no explicit config is supplied", async () => {
    // Inverse case: when the user does NOT pass `dimensions`, the
    // provider should auto-detect from the response and not throw.
    // Locks in the existing behavior so the #66 fix doesn't regress
    // the auto-detect path.
    global.fetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.endsWith("/api/tags")) {
        return new Response(JSON.stringify({ models: [] }), { status: 200 });
      }
      if (u.endsWith("/api/embed")) {
        return new Response(
          JSON.stringify({ embeddings: [new Array(512).fill(0)] }),
          { status: 200 }
        );
      }
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    const p = await createEmbeddingProvider({ SVERKLO_EMBEDDING_PROVIDER: "ollama" });
    const vecs = await p.embed(["hello"]);
    expect(vecs).toHaveLength(1);
    expect(vecs[0].length).toBe(512);
    expect(p.dimensions).toBe(512);
  });
});

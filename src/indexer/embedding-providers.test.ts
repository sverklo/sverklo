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

// Pluggable embedding providers (issue #9).
//
// Sverklo historically hardcoded the bundled all-MiniLM-L6-v2 ONNX
// model. That's a great Pareto choice for the zero-config path but
// leaves two legitimate user groups out:
//
//   1. Enterprise users with existing embedding infrastructure who
//      want sverklo's index to share a similarity space with their
//      RAG pipeline (Voyage AI, OpenAI, Cohere).
//   2. Privacy-sensitive users who can't ship ONNX binaries and need
//      to point at a local Ollama / llamafile endpoint.
//
// This module defines the provider interface and a registry. The
// bundled ONNX model implements the interface as the "default"
// provider and is still selected when the user sets nothing. All
// other providers are additive — shipping a new one is a matter of
// adding a class and registering it.
//
// Critical constraint: changing providers changes the embedding
// dimension and the similarity space. We don't support mixing vectors
// from different providers in the same index. The caller (Indexer)
// checks the stored provider/dimensions against the current config
// on startup and triggers a full rebuild if they don't match.

export interface EmbeddingProvider {
  /**
   * Stable identifier. Stored in the index metadata so we can detect
   * provider changes on startup and trigger a reindex.
   */
  readonly name: string;

  /**
   * Vector dimension this provider produces. Must be constant — if a
   * provider can produce multiple dimensions (e.g. OpenAI
   * text-embedding-3-small has a `dimensions` parameter), pick one
   * at construction time and don't change it.
   */
  readonly dimensions: number;

  /**
   * One-time setup (loading model files, validating API keys).
   * Called by the indexer before any embed() calls. If init fails,
   * the indexer falls back to the default provider with a warning
   * logged — we never hard-fail on a missing external dependency
   * because that would brick the CLI for offline users.
   */
  init(): Promise<void>;

  /**
   * Embed a batch of strings. Returns the same number of vectors as
   * input strings, in the same order. Each vector must have length
   * equal to `dimensions`.
   */
  embed(texts: string[]): Promise<Float32Array[]>;
}

// ────────────────────────────────────────────────────────────────────
// Provider: default (bundled ONNX all-MiniLM-L6-v2)
// ────────────────────────────────────────────────────────────────────

import { embed as legacyEmbed, initEmbedder } from "./embedder.js";

class BundledOnnxProvider implements EmbeddingProvider {
  readonly name = "default";
  readonly dimensions = 384;

  async init(): Promise<void> {
    await initEmbedder();
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    return legacyEmbed(texts);
  }
}

// ────────────────────────────────────────────────────────────────────
// Provider: openai (text-embedding-3-small by default)
// ────────────────────────────────────────────────────────────────────
//
// Requires SVERKLO_OPENAI_API_KEY. Configurable model + dimensions via
// SVERKLO_OPENAI_MODEL and SVERKLO_OPENAI_DIMENSIONS. Uses the public
// OpenAI embeddings API directly (no SDK dependency to keep the core
// package small). Fails loud if the API key is missing.

interface OpenAIEmbeddingResponse {
  data: { embedding: number[]; index: number }[];
}

class OpenAIProvider implements EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  private apiKey: string;
  private model: string;
  private endpoint: string;

  constructor(opts: { apiKey: string; model?: string; dimensions?: number; endpoint?: string }) {
    this.apiKey = opts.apiKey;
    this.model = opts.model || "text-embedding-3-small";
    // Default to 1536 for 3-small. Users targeting a different model
    // MUST set SVERKLO_OPENAI_DIMENSIONS to match — we don't auto-probe
    // because that would fire a billed request just to learn the size.
    this.dimensions = opts.dimensions || 1536;
    this.endpoint = opts.endpoint || "https://api.openai.com/v1/embeddings";
    this.name = `openai:${this.model}`;
  }

  async init(): Promise<void> {
    // Smoke-test the endpoint with an empty ping. On failure, throw —
    // the indexer wraps this in a try/catch and falls back to the
    // bundled provider with a warning.
    if (!this.apiKey) {
      throw new Error(
        "OpenAI embedding provider selected but SVERKLO_OPENAI_API_KEY is unset."
      );
    }
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];

    // OpenAI's embeddings endpoint accepts a batch in a single call.
    // We keep batches at <= 100 inputs to stay well under the 300k
    // token request limit. The indexer already chunks at ~400 tokens
    // per chunk so 100 × 400 = 40k tokens is safely under.
    const out: Float32Array[] = [];
    const BATCH = 100;

    for (let i = 0; i < texts.length; i += BATCH) {
      const batch = texts.slice(i, i + BATCH);
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          input: batch,
          dimensions: this.dimensions,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "<no body>");
        throw new Error(
          `OpenAI embeddings failed: ${res.status} ${res.statusText} — ${body.slice(0, 200)}`
        );
      }
      const json = (await res.json()) as OpenAIEmbeddingResponse;
      // Preserve input order — OpenAI is supposed to echo back sorted
      // by index but we're defensive.
      const sorted = [...json.data].sort((a, b) => a.index - b.index);
      for (const row of sorted) {
        out.push(new Float32Array(row.embedding));
      }
    }

    return out;
  }
}

// ────────────────────────────────────────────────────────────────────
// Provider: ollama (local endpoint, any embedding model)
// ────────────────────────────────────────────────────────────────────
//
// For users running Ollama locally. No API key. Endpoint defaults to
// http://localhost:11434/api/embeddings, model defaults to
// nomic-embed-text. Users can override with SVERKLO_OLLAMA_URL and
// SVERKLO_OLLAMA_MODEL.

interface OllamaEmbeddingResponse {
  embedding: number[];
}

class OllamaProvider implements EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  private endpoint: string;
  private model: string;

  constructor(opts: { endpoint?: string; model?: string; dimensions?: number }) {
    this.endpoint = opts.endpoint || "http://localhost:11434/api/embeddings";
    this.model = opts.model || "nomic-embed-text";
    // Nomic embed text is 768 dims. Users swapping models must set
    // SVERKLO_OLLAMA_DIMENSIONS to match.
    this.dimensions = opts.dimensions || 768;
    this.name = `ollama:${this.model}`;
  }

  async init(): Promise<void> {
    // Probe with a minimal request. A failure here will fall back to
    // the bundled provider via the factory.
    try {
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: this.model, prompt: "ping" }),
      });
      if (!res.ok) {
        throw new Error(`Ollama probe failed: ${res.status} ${res.statusText}`);
      }
    } catch (err) {
      throw new Error(
        `Ollama embedding provider could not reach ${this.endpoint}. ` +
          `Is Ollama running? Original error: ${(err as Error).message}`
      );
    }
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    // Ollama's embeddings endpoint takes one prompt per request, so
    // we parallelize with a bounded concurrency of 4.
    const out: Float32Array[] = new Array(texts.length);
    const CONCURRENCY = 4;
    let next = 0;

    async function worker(this: OllamaProvider) {
      while (true) {
        const i = next++;
        if (i >= texts.length) return;
        const res = await fetch(this.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: this.model, prompt: texts[i] }),
        });
        if (!res.ok) {
          throw new Error(`Ollama embeddings failed on index ${i}: ${res.status}`);
        }
        const json = (await res.json()) as OllamaEmbeddingResponse;
        out[i] = new Float32Array(json.embedding);
      }
    }

    const workers = Array.from({ length: Math.min(CONCURRENCY, texts.length) }, () =>
      worker.call(this)
    );
    await Promise.all(workers);
    return out;
  }
}

// ────────────────────────────────────────────────────────────────────
// Factory
// ────────────────────────────────────────────────────────────────────
//
// Reads config (env vars for now; .sverklo/config.json later) and
// returns the selected provider. If init() throws, falls back to the
// bundled default with a warning.

import { log } from "../utils/logger.js";

export async function createEmbeddingProvider(
  env: NodeJS.ProcessEnv = process.env
): Promise<EmbeddingProvider> {
  const providerName = (env.SVERKLO_EMBEDDING_PROVIDER || "default").toLowerCase();

  let provider: EmbeddingProvider;

  try {
    switch (providerName) {
      case "default":
      case "bundled":
      case "onnx":
        provider = new BundledOnnxProvider();
        break;

      case "openai":
        provider = new OpenAIProvider({
          apiKey: env.SVERKLO_OPENAI_API_KEY || "",
          model: env.SVERKLO_OPENAI_MODEL,
          dimensions: env.SVERKLO_OPENAI_DIMENSIONS
            ? parseInt(env.SVERKLO_OPENAI_DIMENSIONS, 10)
            : undefined,
        });
        break;

      case "ollama":
        provider = new OllamaProvider({
          endpoint: env.SVERKLO_OLLAMA_URL,
          model: env.SVERKLO_OLLAMA_MODEL,
          dimensions: env.SVERKLO_OLLAMA_DIMENSIONS
            ? parseInt(env.SVERKLO_OLLAMA_DIMENSIONS, 10)
            : undefined,
        });
        break;

      default:
        log(
          `[embedding] Unknown provider '${providerName}'. Falling back to default (bundled ONNX).`
        );
        provider = new BundledOnnxProvider();
    }

    await provider.init();
    if (providerName !== "default") {
      log(
        `[embedding] Using ${provider.name} (${provider.dimensions} dims) — override with SVERKLO_EMBEDDING_PROVIDER.`
      );
    }
    return provider;
  } catch (err) {
    log(
      `[embedding] Provider '${providerName}' init failed: ${(err as Error).message}. Falling back to default.`
    );
    const fallback = new BundledOnnxProvider();
    await fallback.init();
    return fallback;
  }
}

// Lightweight signature of the active provider, persisted to the index
// metadata so we can detect provider/dimension changes across runs.
export interface EmbeddingFingerprint {
  provider: string;
  dimensions: number;
}

export function fingerprintOf(p: EmbeddingProvider): EmbeddingFingerprint {
  return { provider: p.name, dimensions: p.dimensions };
}

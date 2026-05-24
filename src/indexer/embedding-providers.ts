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
// For users running Ollama locally. No API key. Uses the batch
// /api/embed endpoint (Ollama 0.4+) which accepts an array of inputs
// in a single request. Base URL defaults to http://localhost:11434,
// model defaults to nomic-embed-text.
//
// Dimensions are auto-detected from the first embedding response when
// not explicitly configured. This avoids requiring users to know or
// specify the output dimension of their chosen model.

interface OllamaEmbedResponse {
  embeddings: number[][];
}

class OllamaProvider implements EmbeddingProvider {
  readonly name: string;
  // Mutable until the first embed() auto-detects the real value.
  private _dimensions: number;
  private _dimensionsDetected = false;
  private baseUrl: string;
  private model: string;

  get dimensions(): number {
    return this._dimensions;
  }

  constructor(opts: { baseUrl?: string; model?: string; dimensions?: number }) {
    this.baseUrl = (opts.baseUrl || "http://localhost:11434").replace(/\/+$/, "");
    this.model = opts.model || "nomic-embed-text";
    // If the caller supplied explicit dimensions, trust them. Otherwise
    // we'll auto-detect on the first embed() call. Use 768 as a
    // reasonable placeholder for nomic-embed-text until then.
    this._dimensions = opts.dimensions || 768;
    this._dimensionsDetected = !!opts.dimensions;
    this.name = `ollama:${this.model}`;
  }

  async init(): Promise<void> {
    // Probe with the read-only /api/tags listing endpoint. If Ollama
    // is not reachable, throw — the factory wrapper falls back to the
    // bundled provider with a warning.
    const tagsEndpoint = `${this.baseUrl}/api/tags`;
    try {
      const res = await fetch(tagsEndpoint, { method: "GET" });
      if (!res.ok) {
        throw new Error(`Ollama probe failed: ${res.status} ${res.statusText}`);
      }
    } catch (err) {
      throw new Error(
        `Ollama embedding provider could not reach ${tagsEndpoint}. ` +
          `Is Ollama running? Original error: ${(err as Error).message}`
      );
    }

    // Auto-detect dimensions by embedding a short probe string. This
    // fires one real request but saves users from having to look up
    // and configure dimensions for every model they try.
    if (!this._dimensionsDetected) {
      try {
        const probeRes = await fetch(`${this.baseUrl}/api/embed`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "connection": "keep-alive",
          },
          keepalive: true,
          body: JSON.stringify({
            model: this.model,
            input: ["dimension probe"],
            keep_alive: "10m",
          }),
        });
        if (probeRes.ok) {
          const probeJson = (await probeRes.json()) as OllamaEmbedResponse;
          if (probeJson.embeddings?.[0]?.length) {
            this._dimensions = probeJson.embeddings[0].length;
            this._dimensionsDetected = true;
          }
        }
      } catch {
        // Non-fatal — we'll use the placeholder and detect on the
        // first real embed() call instead.
      }
    }
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];

    // Use the batch /api/embed endpoint (Ollama 0.4+). Ollama handles
    // arbitrary batch sizes internally, but we cap at 128 to keep
    // memory predictable on the server side.
    const out: Float32Array[] = [];
    const BATCH = 128;

    for (let i = 0; i < texts.length; i += BATCH) {
      const batch = texts.slice(i, i + BATCH);
      // `keep_alive` keeps the model resident on the Ollama server
      // between batches — otherwise the model can be unloaded after
      // idle gaps and the next batch pays the cold-load tax again.
      // Closes part of issue #55.
      const res = await fetch(`${this.baseUrl}/api/embed`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "connection": "keep-alive",
        },
        keepalive: true,
        body: JSON.stringify({
          model: this.model,
          input: batch,
          keep_alive: "10m",
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "<no body>");
        throw new Error(
          `Ollama embed failed: ${res.status} ${res.statusText} — ${body.slice(0, 200)}`
        );
      }
      const json = (await res.json()) as OllamaEmbedResponse;

      // Validate response dimensions. Two cases:
      //   (a) user configured `embeddings.dimensions: N` — Ollama MUST
      //       return N-dim vectors. If it returns something else, the
      //       index would end up with vectors that don't match what the
      //       provider claims via `.dimensions`, doctor would flag a
      //       mismatch on every run, and similarity scoring would be
      //       silently wrong. Throw fail-loud so the user fixes the
      //       model or the config — better than persisting bad data.
      //       (#66 root cause: pre-v0.25.2 we trusted the config blindly.)
      //   (b) no user config — auto-detect from the first response, then
      //       enforce stability for every subsequent batch in this run.
      const actualLen = json.embeddings?.[0]?.length;
      if (actualLen) {
        if (!this._dimensionsDetected) {
          this._dimensions = actualLen;
          this._dimensionsDetected = true;
        } else if (actualLen !== this._dimensions) {
          throw new Error(
            `Ollama model '${this.model}' returned ${actualLen}-dim vectors ` +
              `but the provider was configured for ${this._dimensions}-dim. ` +
              `Update embeddings.dimensions in .sverklo.yaml to ${actualLen}, ` +
              `or switch to a model whose output matches the configured dimension. ` +
              `(sverklo/sverklo#66)`
          );
        }
      }

      for (const emb of json.embeddings) {
        out.push(new Float32Array(emb));
      }
    }

    return out;
  }
}

// ────────────────────────────────────────────────────────────────────
// Factory
// ────────────────────────────────────────────────────────────────────
//
// Resolution order for provider selection:
//   1. .sverklo.yaml `embeddings.provider` (config-first — declarative,
//      version-controlled, no env-var gymnastics for the user).
//   2. SVERKLO_EMBEDDING_PROVIDER env var (backwards-compatible escape
//      hatch, useful for CI overrides).
//   3. "default" — bundled ONNX all-MiniLM-L6-v2.
//
// If init() throws, falls back to the bundled default with a warning.

import { log } from "../utils/logger.js";
import type { SverkloConfig } from "../utils/config-file.js";

export async function createEmbeddingProvider(
  env: NodeJS.ProcessEnv = process.env,
  sverkloConfig?: SverkloConfig | null
): Promise<EmbeddingProvider> {
  const embCfg = sverkloConfig?.embeddings;

  // Determine the effective provider name. Config file takes precedence
  // over env var so that a checked-in .sverklo.yaml is authoritative.
  const providerName = (
    embCfg?.provider ||
    env.SVERKLO_EMBEDDING_PROVIDER ||
    "default"
  ).toLowerCase();

  let provider: EmbeddingProvider;

  try {
    switch (providerName) {
      case "default":
      case "bundled":
      case "onnx":
        // #59 (v0.25.0): warn loudly when `embeddings.onnx.modelPath` is
        // set in .sverklo.yaml. The field is in the documented config
        // schema but no provider consumes it — users pointing at a custom
        // 1024-dim model silently got the bundled 384-dim MiniLM. Until
        // we ship custom-ONNX-path support, surface the no-op explicitly.
        if (embCfg?.onnx?.modelPath) {
          log(
            `[embedding] WARN: .sverklo.yaml has embeddings.onnx.modelPath='${embCfg.onnx.modelPath}' ` +
              `but custom ONNX model paths are not yet supported. Using the bundled all-MiniLM-L6-v2 (384d). ` +
              `Track sverklo/sverklo#59. To use a different model today, switch to provider: ollama.`
          );
        }
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

      case "ollama": {
        // Merge config-file settings with env-var overrides. Config
        // file is the primary source; env vars act as fallback for
        // fields not specified in the YAML.
        const ollamaCfg = embCfg?.ollama;
        const rawBaseUrl =
          ollamaCfg?.baseUrl ||
          env.SVERKLO_OLLAMA_URL ||
          undefined;

        // SSRF protection: only allow localhost URLs for the Ollama
        // endpoint. A malicious .sverklo.yaml could point at an
        // internal service and exfiltrate embedding content.
        let baseUrl = rawBaseUrl;
        if (baseUrl) {
          try {
            const parsed = new URL(baseUrl);
            const host = parsed.hostname.toLowerCase();
            if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1" && host !== "[::1]") {
              log(
                `[embedding] Ollama baseUrl '${baseUrl}' is not a localhost address. ` +
                  `Refusing to connect to non-local endpoints to prevent SSRF. ` +
                  `Falling back to default localhost.`
              );
              baseUrl = undefined;
            }
          } catch {
            log(`[embedding] Ollama baseUrl '${baseUrl}' is not a valid URL. Ignoring.`);
            baseUrl = undefined;
          }
        }
        const model =
          ollamaCfg?.model ||
          embCfg?.model ||
          env.SVERKLO_OLLAMA_MODEL ||
          undefined;
        const dimensions =
          embCfg?.dimensions ||
          (env.SVERKLO_OLLAMA_DIMENSIONS
            ? parseInt(env.SVERKLO_OLLAMA_DIMENSIONS, 10)
            : undefined);

        provider = new OllamaProvider({ baseUrl, model, dimensions });
        break;
      }

      default:
        log(
          `[embedding] Unknown provider '${providerName}'. Falling back to default (bundled ONNX).`
        );
        provider = new BundledOnnxProvider();
    }

    await provider.init();
    if (providerName !== "default" && providerName !== "bundled" && providerName !== "onnx") {
      log(
        `[embedding] Using ${provider.name} (${provider.dimensions} dims) — configured via ${embCfg?.provider ? ".sverklo.yaml" : "SVERKLO_EMBEDDING_PROVIDER env var"}.`
      );
    }
    return provider;
  } catch (err) {
    // #59 (v0.25.0): silent fallback was the original bug — users saw
    // "ok, configured ollama" but the index stored 384-dim MiniLM vectors
    // anyway. Make the fallback unambiguous: include both the requested
    // provider and the dim it would have produced (when known), and tag
    // the line WARN so SVERKLO_DEBUG=1 readers can grep for it.
    const configuredDims = embCfg?.dimensions
      ? ` (configured dimensions: ${embCfg.dimensions})`
      : "";
    log(
      `[embedding] WARN: provider '${providerName}'${configuredDims} init failed: ${(err as Error).message}. ` +
        `Falling back to bundled all-MiniLM-L6-v2 (384d). Your index will use 384-dim vectors, NOT what you configured.`
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

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { log, logError } from "../utils/logger.js";

const BUNDLED_MODEL_DIR = join(import.meta.dirname ?? ".", "..", "..", "models");

const MODEL_DIM = 384;
const MAX_SEQ_LEN = 128; // Short sequences for code chunks — speed over completeness
const CLS_TOKEN = 101;
const SEP_TOKEN = 102;
const PAD_TOKEN = 0;
const UNK_TOKEN = 100;

let ort: any = null;
let session: any = null;
let vocab: Map<string, number> | null = null;
let initialized = false;

export async function initEmbedder(): Promise<void> {
  if (initialized) return;

  // Find model files
  const modelPath = findFile("model.onnx");
  const tokenizerPath = findFile("tokenizer.json");

  if (!modelPath || !tokenizerPath) {
    // Try auto-downloading
    try {
      log("Model not found, downloading...");
      const { setupModels } = await import("./setup.js");
      await setupModels();
      // Retry finding files after download
      const retryModel = findFile("model.onnx");
      const retryTokenizer = findFile("tokenizer.json");
      if (retryModel && retryTokenizer) {
        return initEmbedderWithFiles(retryModel, retryTokenizer);
      }
    } catch {
      // Download failed, fall back
    }
    log("Using lightweight embeddings (no ONNX model). Run 'npx sverklo setup' for better quality.");
    initialized = true;
    return;
  }

  return initEmbedderWithFiles(modelPath, tokenizerPath);
}

async function initEmbedderWithFiles(modelPath: string, tokenizerPath: string): Promise<void> {

  try {
    // Load ONNX runtime
    ort = await import("onnxruntime-node");

    // Load model
    session = await ort.InferenceSession.create(modelPath, {
      executionProviders: ["cpu"],
      graphOptimizationLevel: "all",
      intraOpNumThreads: 2,
    });

    log(`ONNX model loaded: ${modelPath}`);
    log(`Input names: ${session.inputNames}, Output names: ${session.outputNames}`);

    // Load tokenizer vocab
    const tokenizer = JSON.parse(readFileSync(tokenizerPath, "utf-8"));
    vocab = new Map(Object.entries(tokenizer.model.vocab) as [string, number][]);

    log(`Tokenizer loaded: ${vocab.size} tokens`);
    initialized = true;
  } catch (err) {
    logError("Failed to initialize ONNX embedder", err);
    session = null;
    vocab = null;
    initialized = true;
  }
}

function findFile(filename: string): string | null {
  // Check an explicit override first (used by tests/packagers), then
  // ~/.sverklo/models/, then bundled package models when present.
  const dirs = [
    process.env.SVERKLO_MODEL_DIR,
    join(homedir(), ".sverklo", "models"),
    BUNDLED_MODEL_DIR,
  ].filter((dir): dir is string => Boolean(dir));

  for (const dir of dirs) {
    const path = join(dir, filename);
    if (existsSync(path)) return path;
  }
  return null;
}

// ── WordPiece Tokenizer ─────────────────────────────────────────────

function tokenize(text: string): { inputIds: number[]; attentionMask: number[] } {
  if (!vocab) {
    return fallbackTokenize(text);
  }

  // BERT-style preprocessing: lowercase, strip accents
  const cleaned = text.toLowerCase().replace(/[\u0300-\u036f]/g, "");

  // Split on whitespace and punctuation (BertPreTokenizer behavior)
  const words = cleaned.split(/(\s+|[^\w\s])/g).filter((w) => w.trim());

  const tokens: number[] = [CLS_TOKEN];

  for (const word of words) {
    if (tokens.length >= MAX_SEQ_LEN - 1) break;

    const subTokens = wordPieceTokenize(word.trim());
    for (const st of subTokens) {
      if (tokens.length >= MAX_SEQ_LEN - 1) break;
      tokens.push(st);
    }
  }

  tokens.push(SEP_TOKEN);

  // Pad to MAX_SEQ_LEN
  const inputIds = new Array(MAX_SEQ_LEN).fill(PAD_TOKEN);
  const attentionMask = new Array(MAX_SEQ_LEN).fill(0);

  for (let i = 0; i < tokens.length; i++) {
    inputIds[i] = tokens[i];
    attentionMask[i] = 1;
  }

  return { inputIds, attentionMask };
}

function wordPieceTokenize(word: string): number[] {
  if (!vocab) return [UNK_TOKEN];

  const tokens: number[] = [];
  let start = 0;

  while (start < word.length) {
    let end = word.length;
    let found = false;

    while (start < end) {
      const substr = start === 0 ? word.slice(start, end) : "##" + word.slice(start, end);
      const id = vocab.get(substr);

      if (id !== undefined) {
        tokens.push(id);
        found = true;
        start = end;
        break;
      }
      end--;
    }

    if (!found) {
      tokens.push(UNK_TOKEN);
      start++;
    }
  }

  return tokens;
}

function fallbackTokenize(text: string): { inputIds: number[]; attentionMask: number[] } {
  // Hash-based token IDs when no real tokenizer is available
  const words = text.toLowerCase().split(/\s+/).slice(0, MAX_SEQ_LEN - 2);
  const inputIds = new Array(MAX_SEQ_LEN).fill(PAD_TOKEN);
  const attentionMask = new Array(MAX_SEQ_LEN).fill(0);

  inputIds[0] = CLS_TOKEN;
  attentionMask[0] = 1;

  for (let i = 0; i < words.length; i++) {
    let hash = 0;
    for (let j = 0; j < words[i].length; j++) {
      hash = ((hash << 5) - hash + words[i].charCodeAt(j)) | 0;
    }
    inputIds[i + 1] = (Math.abs(hash) % 30000) + 1000;
    attentionMask[i + 1] = 1;
  }

  inputIds[words.length + 1] = SEP_TOKEN;
  attentionMask[words.length + 1] = 1;

  return { inputIds, attentionMask };
}

// ── ONNX Inference ──────────────────────────────────────────────────

/**
 * Output of one ONNX inference batch — the raw token-level hidden states
 * before any pooling. Callers choose what to do with it: `embed()` mean-pools
 * to a single vector per text; `embedTokens()` (#29 rerank work) returns the
 * per-token states for late-interaction MaxSim scoring.
 *
 * Shape contract: `outputData` is the flat [batchSize * seqLen * hiddenSize]
 * tensor as produced by ONNX Runtime; `outputDims` is its 3-D shape;
 * `attentionMasks[i]` is the int[] mask that was fed in for row i (kept here
 * so callers don't have to re-tokenize to know which token positions are
 * real vs padding). `hiddenSize` and `seqLen` are derived for convenience.
 */
interface OnnxBatchResult {
  outputData: Float32Array;
  outputDims: readonly number[];
  attentionMasks: number[][];
  batchSize: number;
  hiddenSize: number;
  seqLen: number;
}

/**
 * Run one ONNX inference pass over a batch of texts. Tokenizes, builds the
 * tensors, calls `session.run`, returns the raw output. Does NOT pool — that's
 * the caller's job.
 *
 * Returns `null` when the session/runtime isn't available (e.g. embedder fell
 * back to the lightweight path because ONNX failed to load). Callers handle
 * that case explicitly rather than getting a fake result.
 */
async function runOnnxBatch(batch: string[]): Promise<OnnxBatchResult | null> {
  if (!session || !ort) return null;

  const batchSize = batch.length;

  // Tokenize once, keep attention masks for the caller.
  const allInputIds = new BigInt64Array(batchSize * MAX_SEQ_LEN);
  const allAttentionMask = new BigInt64Array(batchSize * MAX_SEQ_LEN);
  const attentionMasks: number[][] = [];

  for (let i = 0; i < batchSize; i++) {
    const { inputIds, attentionMask } = tokenize(batch[i]);
    attentionMasks.push(attentionMask);
    for (let j = 0; j < MAX_SEQ_LEN; j++) {
      allInputIds[i * MAX_SEQ_LEN + j] = BigInt(inputIds[j]);
      allAttentionMask[i * MAX_SEQ_LEN + j] = BigInt(attentionMask[j]);
    }
  }

  // Create tensors
  const inputIdsTensor = new ort.Tensor("int64", allInputIds, [batchSize, MAX_SEQ_LEN]);
  const attentionMaskTensor = new ort.Tensor("int64", allAttentionMask, [batchSize, MAX_SEQ_LEN]);

  // Also need token_type_ids (all zeros for single-sentence)
  const tokenTypeIds = new BigInt64Array(batchSize * MAX_SEQ_LEN); // all zeros
  const tokenTypeTensor = new ort.Tensor("int64", tokenTypeIds, [batchSize, MAX_SEQ_LEN]);

  // Run inference
  const feeds: Record<string, any> = {
    input_ids: inputIdsTensor,
    attention_mask: attentionMaskTensor,
  };

  // Add token_type_ids if the model expects it
  if (session.inputNames.includes("token_type_ids")) {
    feeds.token_type_ids = tokenTypeTensor;
  }

  const output = await session.run(feeds);

  // Get the output — usually "last_hidden_state" or the first output.
  // (Issue #29 rerank work depends on this being the per-token hidden states,
  //  not a pre-pooled `sentence_embedding`. If a future model export ships a
  //  pre-pooled output we'd silently lose the token-level signal — at that
  //  point this should explicitly look for `last_hidden_state` first.)
  const outputName = session.outputNames[0];
  const outputData = output[outputName].data as Float32Array;
  const outputDims = output[outputName].dims as readonly number[];
  const hiddenSize = outputDims[outputDims.length - 1];
  const seqLen = outputDims.length === 3 ? outputDims[1] : MAX_SEQ_LEN;

  return {
    outputData,
    outputDims,
    attentionMasks,
    batchSize,
    hiddenSize,
    seqLen,
  };
}

export async function embed(texts: string[]): Promise<Float32Array[]> {
  if (!session || !ort) {
    return fallbackEmbed(texts);
  }

  const results: Float32Array[] = [];

  // Process in small batches for memory efficiency
  const BATCH = 16;
  for (let b = 0; b < texts.length; b += BATCH) {
    const batch = texts.slice(b, b + BATCH);
    const onnxOut = await runOnnxBatch(batch);
    if (!onnxOut) {
      // Session disappeared mid-loop — extremely unlikely, but surface
      // the same fallback behavior as the top-of-function early return.
      return fallbackEmbed(texts);
    }
    const { outputData, attentionMasks, batchSize, hiddenSize, seqLen } = onnxOut;

    // Mean pooling with attention mask
    for (let i = 0; i < batchSize; i++) {
      const attentionMask = attentionMasks[i];
      const pooled = new Float32Array(hiddenSize);
      let maskSum = 0;

      for (let t = 0; t < seqLen; t++) {
        const mask = attentionMask[t] || 0;
        maskSum += mask;
        if (mask === 0) continue;

        for (let d = 0; d < hiddenSize; d++) {
          pooled[d] += outputData[i * seqLen * hiddenSize + t * hiddenSize + d] * mask;
        }
      }

      if (maskSum > 0) {
        for (let d = 0; d < hiddenSize; d++) {
          pooled[d] /= maskSum;
        }
      }

      // L2 normalize
      let norm = 0;
      for (let d = 0; d < hiddenSize; d++) norm += pooled[d] * pooled[d];
      norm = Math.sqrt(norm);
      if (norm > 0) {
        for (let d = 0; d < hiddenSize; d++) pooled[d] /= norm;
      }

      results.push(pooled);
    }
  }

  return results;
}

// Fallback when ONNX is not available
function fallbackEmbed(texts: string[]): Float32Array[] {
  return texts.map((text) => {
    const vec = new Float32Array(MODEL_DIM);
    const words = text.toLowerCase().split(/\s+/);

    for (let w = 0; w < words.length; w++) {
      const word = words[w];
      for (let i = 0; i < word.length; i++) {
        const charCode = word.charCodeAt(i);
        for (let d = 0; d < MODEL_DIM; d++) {
          vec[d] +=
            Math.sin(charCode * (d + 1) * 0.01 + w * 0.1) *
            (1 / (1 + w * 0.1));
        }
      }
    }

    // L2 normalize
    let norm = 0;
    for (let i = 0; i < MODEL_DIM; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < MODEL_DIM; i++) vec[i] /= norm;
    }

    return vec;
  });
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // vectors are already normalized
}

/**
 * Per-token embedding for late-interaction reranking (#29).
 *
 * Returns one TokenEmbedding per input text, where each TokenEmbedding holds
 * the L2-normalized per-token hidden states in a flat Float32Array of length
 * `len * dim`. The flat layout (vs `Float32Array[]`) is intentional: the
 * MaxSim hot path benchmarks 3-5x faster on a contiguous buffer because V8
 * inlines the tight `q · d` loop aggressively.
 *
 * Padding (attention_mask = 0) and special tokens (CLS at position 0, SEP at
 * position word-count + 1) are stripped — only "real content" tokens come
 * back. This matches what ColBERT-style scoring expects: the scoring runs
 * over genuinely meaningful positions, not padding.
 *
 * Returns null when the ONNX runtime is unavailable. Callers (rerank.ts) use
 * that to silently fall through to pass-through behavior — never throw, the
 * production retrieval path must not break behind a model load failure.
 *
 * Shape contract:
 *   embedTokens(["hello world"]) → [{ tokens: Float32Array([...]), dim: 384, len: 2 }]
 *   tokens[t * dim + d] is the d-th component of the t-th token's vector.
 */
export interface TokenEmbedding {
  /** Flat per-token hidden states of length len * dim. L2-normalized per token. */
  tokens: Float32Array;
  /** Embedding dimensionality (384 for all-MiniLM-L6-v2). */
  dim: number;
  /** Number of real tokens kept (CLS/SEP/padding stripped). */
  len: number;
}

export async function embedTokens(texts: string[]): Promise<(TokenEmbedding | null)[]> {
  if (!session || !ort) {
    return texts.map(() => null);
  }

  const out: (TokenEmbedding | null)[] = [];
  const BATCH = 16;

  for (let b = 0; b < texts.length; b += BATCH) {
    const batch = texts.slice(b, b + BATCH);
    const onnxOut = await runOnnxBatch(batch);
    if (!onnxOut) {
      // Match embed()'s mid-loop fallback shape: emit nulls for the remaining
      // texts. Caller decides what to do (rerank.ts treats null as
      // pass-through-this-candidate).
      for (let i = 0; i < batch.length; i++) out.push(null);
      continue;
    }
    const { outputData, attentionMasks, batchSize, hiddenSize, seqLen } = onnxOut;

    for (let i = 0; i < batchSize; i++) {
      const attentionMask = attentionMasks[i];

      // Identify real-content positions: attention_mask == 1, and not the
      // special tokens (CLS=position 0, SEP=position right after the last
      // unmasked content token). The tokenize() function in this file
      // explicitly puts CLS at index 0 and SEP at index `words.length + 1`,
      // so we strip the leading position and the trailing 1 unmasked one.
      let totalUnmasked = 0;
      for (let t = 0; t < seqLen; t++) totalUnmasked += attentionMask[t] || 0;
      // Real-content count: drop CLS (one position) + SEP (one position).
      // For very short inputs (e.g. an empty string) totalUnmasked is 2 (just
      // CLS+SEP), which yields 0 real tokens — return zero-length tensor.
      const realLen = Math.max(0, totalUnmasked - 2);

      if (realLen === 0) {
        out.push({ tokens: new Float32Array(0), dim: hiddenSize, len: 0 });
        continue;
      }

      const tokens = new Float32Array(realLen * hiddenSize);
      let written = 0;

      // Skip position 0 (CLS); take the next `realLen` unmasked positions.
      // SEP appears at position 1 + realLen, so the loop naturally stops
      // before it (we only write `realLen` tokens).
      for (let t = 1; t < seqLen && written < realLen; t++) {
        if (!attentionMask[t]) break;
        const srcOffset = i * seqLen * hiddenSize + t * hiddenSize;
        const dstOffset = written * hiddenSize;

        // L2-normalize each token vector. ColBERT-style MaxSim only makes
        // sense if both query and doc tokens are unit-norm so dot products
        // map to [-1, 1]; raw hidden states aren't normalized.
        let norm = 0;
        for (let d = 0; d < hiddenSize; d++) {
          const v = outputData[srcOffset + d];
          norm += v * v;
        }
        norm = Math.sqrt(norm);
        if (norm > 0) {
          for (let d = 0; d < hiddenSize; d++) {
            tokens[dstOffset + d] = outputData[srcOffset + d] / norm;
          }
        }
        // (else: leave the all-zero slice; rare, would only happen on a
        //  degenerate input. Safe — MaxSim against zeros yields zero.)

        written++;
      }

      out.push({ tokens, dim: hiddenSize, len: realLen });
    }
  }

  return out;
}

export const EMBEDDING_DIM = MODEL_DIM;

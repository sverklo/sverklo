import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { log, logError } from "../utils/logger.js";

const MODEL_DIR = join(homedir(), ".sverklo", "models");
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
    logError(
      "Model files not found. Falling back to lightweight embeddings.\n" +
        "For better search quality, place model.onnx and tokenizer.json in ~/.sverklo/models/"
    );
    initialized = true;
    return;
  }

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
  // Check ~/.sverklo/models/ first, then bundled
  const userPath = join(MODEL_DIR, filename);
  if (existsSync(userPath)) return userPath;
  const bundledPath = join(BUNDLED_MODEL_DIR, filename);
  if (existsSync(bundledPath)) return bundledPath;
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

export async function embed(texts: string[]): Promise<Float32Array[]> {
  if (!session || !ort) {
    return fallbackEmbed(texts);
  }

  const results: Float32Array[] = [];

  // Process in small batches for memory efficiency
  const BATCH = 16;
  for (let b = 0; b < texts.length; b += BATCH) {
    const batch = texts.slice(b, b + BATCH);
    const batchSize = batch.length;

    // Tokenize batch
    const allInputIds = new BigInt64Array(batchSize * MAX_SEQ_LEN);
    const allAttentionMask = new BigInt64Array(batchSize * MAX_SEQ_LEN);

    for (let i = 0; i < batchSize; i++) {
      const { inputIds, attentionMask } = tokenize(batch[i]);
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

    // Get the output — usually "last_hidden_state" or the first output
    const outputName = session.outputNames[0];
    const outputData = output[outputName].data as Float32Array;
    const outputDims = output[outputName].dims; // [batchSize, seqLen, hiddenSize]
    const hiddenSize = outputDims[outputDims.length - 1];
    const seqLen = outputDims.length === 3 ? outputDims[1] : MAX_SEQ_LEN;

    // Mean pooling with attention mask
    for (let i = 0; i < batchSize; i++) {
      const { attentionMask } = tokenize(batch[i]);
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

export const EMBEDDING_DIM = MODEL_DIM;

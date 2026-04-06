import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { log, logError } from "../utils/logger.js";

const MODEL_DIR = join(homedir(), ".lumen", "models");
const MODEL_URL =
  "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/onnx/model.onnx";
const TOKENIZER_URL =
  "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/tokenizer.json";

export async function setupModels(): Promise<void> {
  mkdirSync(MODEL_DIR, { recursive: true });

  const modelPath = join(MODEL_DIR, "model.onnx");
  const tokenizerPath = join(MODEL_DIR, "tokenizer.json");

  if (existsSync(modelPath) && existsSync(tokenizerPath)) {
    console.log("Models already downloaded at", MODEL_DIR);
    return;
  }

  console.log("Downloading embedding model (~90MB)...");

  if (!existsSync(modelPath)) {
    console.log("  Downloading model.onnx...");
    const resp = await fetch(MODEL_URL);
    if (!resp.ok) throw new Error(`Failed to download model: ${resp.status}`);
    const buffer = Buffer.from(await resp.arrayBuffer());
    const { writeFileSync } = await import("node:fs");
    writeFileSync(modelPath, buffer);
    console.log("  model.onnx downloaded");
  }

  if (!existsSync(tokenizerPath)) {
    console.log("  Downloading tokenizer.json...");
    const resp = await fetch(TOKENIZER_URL);
    if (!resp.ok) throw new Error(`Failed to download tokenizer: ${resp.status}`);
    const text = await resp.text();
    const { writeFileSync } = await import("node:fs");
    writeFileSync(tokenizerPath, text);
    console.log("  tokenizer.json downloaded");
  }

  console.log("Setup complete! Models saved to", MODEL_DIR);
}

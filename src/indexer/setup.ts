import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { log, logError } from "../utils/logger.js";
import { verifyArtifact } from "../utils/integrity.js";

function modelDir(): string {
  return process.env.SVERKLO_MODEL_DIR || join(homedir(), ".sverklo", "models");
}

const MODEL_URL =
  "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/onnx/model.onnx";
const TOKENIZER_URL =
  "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/tokenizer.json";

// Progress messages go to stderr so they don't contaminate stdout when
// a caller is piping it into a file or JSON parser. Caught by audit-self
// CI in PR #33 where these strings landed inside /tmp/audit.json and
// broke the downstream JSON.parse check.
export async function setupModels(): Promise<void> {
  const MODEL_DIR = modelDir();
  mkdirSync(MODEL_DIR, { recursive: true });

  const modelPath = join(MODEL_DIR, "model.onnx");
  const tokenizerPath = join(MODEL_DIR, "tokenizer.json");

  if (existsSync(modelPath) && existsSync(tokenizerPath)) {
    console.error("Models already downloaded at", MODEL_DIR);
    return;
  }

  console.error("Downloading embedding model (~90MB)...");

  if (!existsSync(modelPath)) {
    console.error("  Downloading model.onnx...");
    const resp = await fetch(MODEL_URL);
    if (!resp.ok) throw new Error(`Failed to download model: ${resp.status}`);
    const buffer = Buffer.from(await resp.arrayBuffer());
    // Integrity check (Tier 3.2 / Security review 2026-05-13). Throws
    // with a clear remediation message on hash mismatch — refusing to
    // write attacker bytes is the whole point of the lock file.
    //
    // strict + allowMissingLock:false means: refuse to write if the
    // lock file is missing, not just soft-warn. The npm package ships
    // models.lock.json in `files`; a missing lock indicates a packaging
    // accident or tampering. Dogfood review 2026-05-14 (Issue B)
    // flagged the soft-warn default as a HIGH regression of the
    // pinning promise.
    verifyArtifact("model", "model.onnx", buffer, {
      strict: true,
      allowMissingLock: false,
    });
    const { writeFileSync } = await import("node:fs");
    writeFileSync(modelPath, buffer);
    console.error("  model.onnx downloaded (integrity verified)");
  }

  if (!existsSync(tokenizerPath)) {
    console.error("  Downloading tokenizer.json...");
    const resp = await fetch(TOKENIZER_URL);
    if (!resp.ok) throw new Error(`Failed to download tokenizer: ${resp.status}`);
    const text = await resp.text();
    const buffer = Buffer.from(text, "utf-8");
    verifyArtifact("model", "tokenizer.json", buffer, {
      strict: true,
      allowMissingLock: false,
    });
    const { writeFileSync } = await import("node:fs");
    writeFileSync(tokenizerPath, text);
    console.error("  tokenizer.json downloaded (integrity verified)");
  }

  console.error("Setup complete! Models saved to", MODEL_DIR);
}

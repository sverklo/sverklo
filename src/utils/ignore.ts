import ignore, { type Ignore } from "ignore";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const HARDCODED_IGNORES = [
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "__pycache__",
  ".pytest_cache",
  "vendor",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".venv",
  "venv",
  "env",
  ".env",
  "target", // Rust
  "Pods", // iOS
  ".gradle",
  "*.min.js",
  "*.min.css",
  "*.map",
  "*.lock",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "*.wasm",
  "*.png",
  "*.jpg",
  "*.jpeg",
  "*.gif",
  "*.ico",
  "*.svg",
  "*.woff",
  "*.woff2",
  "*.ttf",
  "*.eot",
  "*.mp3",
  "*.mp4",
  "*.avi",
  "*.pdf",
  "*.zip",
  "*.tar",
  "*.gz",
  "*.exe",
  "*.dll",
  "*.so",
  "*.dylib",
  "*.bin",
  "*.dat",
  "*.db",
  "*.sqlite",
  ".DS_Store",
  "Thumbs.db",
];

export function createIgnoreFilter(rootPath: string): Ignore {
  const ig = ignore();

  ig.add(HARDCODED_IGNORES);

  const gitignorePath = join(rootPath, ".gitignore");
  if (existsSync(gitignorePath)) {
    ig.add(readFileSync(gitignorePath, "utf-8"));
  }

  const aiderIgnorePath = join(rootPath, ".aiderignore");
  if (existsSync(aiderIgnorePath)) {
    ig.add(readFileSync(aiderIgnorePath, "utf-8"));
  }

  const customIgnorePath = join(rootPath, ".sverkloignore");
  if (existsSync(customIgnorePath)) {
    ig.add(readFileSync(customIgnorePath, "utf-8"));
  }

  return ig;
}

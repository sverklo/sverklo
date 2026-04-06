import { join } from "node:path";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import type { ProjectConfig } from "../types/index.js";

const DATA_ROOT = join(homedir(), ".lumen");

export function getProjectConfig(rootPath: string): ProjectConfig {
  const hash = createHash("sha256").update(rootPath).digest("hex").slice(0, 12);
  const name = rootPath.split("/").pop() || "unknown";
  const dataDir = join(DATA_ROOT, `${name}-${hash}`);
  mkdirSync(dataDir, { recursive: true });

  return {
    rootPath,
    name,
    dataDir,
    dbPath: join(dataDir, "index.db"),
  };
}

import { join, basename } from "node:path";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import type { ProjectConfig } from "../types/index.js";

const DATA_ROOT = join(homedir(), ".sverklo");

export function getProjectConfig(rootPath: string): ProjectConfig {
  const hash = createHash("sha256").update(rootPath).digest("hex").slice(0, 12);
  // Issue #20 (NerdChieftain): on Windows, rootPath looks like
  // `C:\repos\project`, so split("/") returns the whole path as one
  // segment and `name` becomes invalid for use as a directory. Use
  // path.basename(), which is platform-aware automatically.
  const name = basename(rootPath) || "unknown";
  const dataDir = join(DATA_ROOT, `${name}-${hash}`);
  mkdirSync(dataDir, { recursive: true });

  return {
    rootPath,
    name,
    dataDir,
    dbPath: join(dataDir, "index.db"),
  };
}

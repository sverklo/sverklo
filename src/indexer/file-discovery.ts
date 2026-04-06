import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { Ignore } from "ignore";
import { detectLanguage } from "../types/index.js";

export interface DiscoveredFile {
  absolutePath: string;
  relativePath: string;
  language: string;
  lastModified: number;
  sizeBytes: number;
}

const MAX_FILE_SIZE = 1_000_000; // 1MB - skip huge files

export function discoverFiles(
  rootPath: string,
  ignoreFilter: Ignore
): DiscoveredFile[] {
  const files: DiscoveredFile[] = [];

  function walk(dir: string) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absPath = join(dir, entry.name);
      const relPath = relative(rootPath, absPath);

      if (ignoreFilter.ignores(relPath)) continue;

      if (entry.isDirectory()) {
        // Also check directory with trailing slash
        if (!ignoreFilter.ignores(relPath + "/")) {
          walk(absPath);
        }
      } else if (entry.isFile()) {
        const lang = detectLanguage(entry.name);
        if (!lang) continue;

        let stat;
        try {
          stat = statSync(absPath);
        } catch {
          continue;
        }

        if (stat.size > MAX_FILE_SIZE) continue;

        files.push({
          absolutePath: absPath,
          relativePath: relPath,
          language: lang,
          lastModified: stat.mtimeMs,
          sizeBytes: stat.size,
        });
      }
    }
  }

  walk(rootPath);
  return files;
}

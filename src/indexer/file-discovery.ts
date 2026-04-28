import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Ignore } from "ignore";
import { detectLanguage } from "../types/index.js";

/**
 * Convert a platform-native path to forward-slash form.
 * Issue #20: on Windows, `relative()` returns `src\server\foo.ts`.
 * We normalize to `src/server/foo.ts` once at storage time so all
 * downstream code (PageRank, search, audit, ignore patterns,
 * dependency-graph keys) works on a single canonical separator
 * regardless of platform.
 */
export function toForwardSlashes(p: string): string {
  return sep === "/" ? p : p.split(sep).join("/");
}

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
      // Issue #20: normalize to forward slashes so stored paths and
      // gitignore matching are platform-independent. The `ignore`
      // library expects POSIX paths; on Windows, passing native
      // backslashed paths breaks pattern matching against user
      // .gitignore rules like `dist/` or `src/**/*.test.ts`.
      const relPath = toForwardSlashes(relative(rootPath, absPath));

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

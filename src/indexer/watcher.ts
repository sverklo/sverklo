import { watch } from "chokidar";
import { relative } from "node:path";
import { detectLanguage } from "../types/index.js";
import { createIgnoreFilter } from "../utils/ignore.js";
import { log } from "../utils/logger.js";
import type { Indexer } from "./indexer.js";

export function startWatcher(indexer: Indexer, rootPath: string): void {
  const ignoreFilter = createIgnoreFilter(rootPath);

  // Debounce map: path -> timeout
  const pending = new Map<string, NodeJS.Timeout>();
  const DEBOUNCE_MS = 500;

  const watcher = watch(rootPath, {
    ignored: (path: string) => {
      const rel = relative(rootPath, path);
      if (!rel) return false;
      try {
        return ignoreFilter.ignores(rel);
      } catch {
        return false;
      }
    },
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300 },
  });

  function handleChange(absolutePath: string) {
    const rel = relative(rootPath, absolutePath);
    const lang = detectLanguage(absolutePath);
    if (!lang) return;

    // Any real change invalidates the freshness cache immediately so the
    // next sverklo_status reflects reality without waiting for the TTL.
    indexer.invalidateFreshnessCache();

    // Debounce
    const existing = pending.get(rel);
    if (existing) clearTimeout(existing);

    pending.set(
      rel,
      setTimeout(async () => {
        pending.delete(rel);
        log(`File changed: ${rel}`);
        await indexer.reindexFile(rel, absolutePath, lang);
      }, DEBOUNCE_MS)
    );
  }

  watcher.on("add", handleChange);
  watcher.on("change", handleChange);
  watcher.on("unlink", (absolutePath: string) => {
    const rel = relative(rootPath, absolutePath);
    log(`File removed: ${rel}`);
    indexer.invalidateFreshnessCache();
    indexer.removeFile(rel);
  });

  log("File watcher started");
}

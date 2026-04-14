import { watch } from "chokidar";
import { basename, relative } from "node:path";
import { detectLanguage } from "../types/index.js";
import { createIgnoreFilter } from "../utils/ignore.js";
import { loadSverkloConfig } from "../utils/config-file.js";
import { log } from "../utils/logger.js";
import type { Indexer } from "./indexer.js";

/** File names that, when changed, should trigger a full reindex. */
const CONFIG_FILES = new Set([".sverklo.yaml", ".sverklo.yml"]);

export function startWatcher(indexer: Indexer, rootPath: string): void {
  const ignoreFilter = createIgnoreFilter(rootPath);

  // Debounce map: path -> timeout
  const pending = new Map<string, NodeJS.Timeout>();
  const DEBOUNCE_MS = 500;

  const watcher = watch(rootPath, {
    ignored: (path: string) => {
      const rel = relative(rootPath, path);
      if (!rel) return false;
      // Never ignore config files — we need to watch them for changes
      if (CONFIG_FILES.has(rel)) return false;
      try {
        return ignoreFilter.ignores(rel);
      } catch {
        return false;
      }
    },
    followSymlinks: false,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300 },
  });

  function handleConfigChange(absolutePath: string) {
    const rel = relative(rootPath, absolutePath);
    log(`Config file changed: ${rel} — triggering full reindex`);
    indexer.invalidateFreshnessCache();

    // Reload the config on the indexer
    indexer.sverkloConfig = loadSverkloConfig(rootPath);

    // Debounce config-triggered reindex
    const existing = pending.get("__config__");
    if (existing) clearTimeout(existing);

    pending.set(
      "__config__",
      setTimeout(async () => {
        pending.delete("__config__");
        await indexer.index();
      }, DEBOUNCE_MS)
    );
  }

  function handleChange(absolutePath: string) {
    const rel = relative(rootPath, absolutePath);

    // Config file changes trigger a full reindex
    if (CONFIG_FILES.has(rel)) {
      handleConfigChange(absolutePath);
      return;
    }

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

    // Config file deletion also triggers reindex (weights reset to defaults)
    if (CONFIG_FILES.has(rel)) {
      handleConfigChange(absolutePath);
      return;
    }

    log(`File removed: ${rel}`);
    indexer.invalidateFreshnessCache();
    indexer.removeFile(rel);
  });

  log("File watcher started");
}

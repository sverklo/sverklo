import { Indexer } from "../indexer/indexer.js";
import { getProjectConfig } from "../utils/config.js";
import { getRegistry, type RegistryEntry } from "./registry.js";
import { log, logError } from "../utils/logger.js";

/**
 * Manages multiple Indexer instances (one per registered repo).
 * Indexers are lazily created on first access and cached for reuse.
 */
export class IndexerPool {
  private indexers: Map<string, Indexer> = new Map();
  private indexPromises: Map<string, Promise<void>> = new Map();

  /**
   * Get an Indexer for the given repo name.
   *
   * - If repoName is provided, resolves that specific repo from the registry.
   * - If repoName is omitted and exactly one repo is registered, uses that one.
   * - If repoName is omitted and multiple repos exist, throws with guidance.
   */
  getIndexer(repoName?: string): Indexer {
    const repos = getRegistry();
    const repoNames = Object.keys(repos);

    let resolved: string;
    let entry: RegistryEntry;

    if (repoName) {
      if (!repos[repoName]) {
        const available = repoNames.join(", ") || "(none)";
        throw new Error(
          `Repository "${repoName}" not found in registry. ` +
          `Available repos: ${available}. Use sverklo_list_repos to see all.`
        );
      }
      resolved = repoName;
      entry = repos[repoName];
    } else if (repoNames.length === 1) {
      resolved = repoNames[0];
      entry = repos[resolved];
    } else if (repoNames.length === 0) {
      throw new Error(
        "No repositories registered. Run `sverklo init` in a project or " +
        "`sverklo register <path>` to add one."
      );
    } else {
      throw new Error(
        `Multiple repositories registered (${repoNames.join(", ")}). ` +
        `Please specify which repo with the "repo" parameter. ` +
        `Use sverklo_list_repos to see all registered repos.`
      );
    }

    // Return cached indexer if available
    if (this.indexers.has(resolved)) {
      return this.indexers.get(resolved)!;
    }

    // Lazy-create the indexer
    log(`[pool] Creating indexer for repo "${resolved}" at ${entry.path}`);
    const config = getProjectConfig(entry.path);
    const indexer = new Indexer(config);
    this.indexers.set(resolved, indexer);

    // Start background indexing
    const indexPromise = indexer.index().catch((err) => {
      logError(`[pool] Indexing failed for "${resolved}"`, err);
    });
    this.indexPromises.set(resolved, indexPromise);

    return indexer;
  }

  /**
   * Wait for the indexer's initial indexing to complete.
   * Returns immediately if the indexer hasn't been created yet (lazy).
   */
  async waitForIndex(repoName?: string): Promise<void> {
    const repos = getRegistry();
    const repoNames = Object.keys(repos);

    let resolved: string;
    if (repoName) {
      resolved = repoName;
    } else if (repoNames.length === 1) {
      resolved = repoNames[0];
    } else {
      // If multiple repos and no name specified, getIndexer will throw.
      // Let it handle the error.
      return;
    }

    const promise = this.indexPromises.get(resolved);
    if (promise) await promise;
  }

  listRepos(): string[] {
    return Object.keys(getRegistry());
  }

  close(): void {
    for (const [name, indexer] of this.indexers) {
      log(`[pool] Closing indexer for "${name}"`);
      indexer.close();
    }
    this.indexers.clear();
    this.indexPromises.clear();
  }
}

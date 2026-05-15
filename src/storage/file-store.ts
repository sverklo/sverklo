import type { Database, Statement } from "./database.js";
import type { FileRecord } from "../types/index.js";

export class FileStore {
  private insertStmt: Statement;
  private getByPathStmt: Statement;
  private getAllStmt: Statement;
  private deleteStmt: Statement;
  private updatePagerankStmt: Statement;
  private getLanguagesStmt: Statement;

  // In-memory snapshot of every getAll() result. The file set turns over
  // rarely (only on indexer writes), but is read 20+ times per tool
  // invocation across audit, clusters, wiki, investigate, dependencies,
  // and find-references. Without this cache, each handler re-scanned the
  // files table from SQLite — that's full-table reads stacking up on
  // every warm MCP call.
  //
  // Architectural review 2026-05-13 (Perf P7) measured 10-30ms per
  // affected call. Invalidation is internal: upsert / delete /
  // updatePagerank null the cache, so the next read repopulates.
  private cachedAll: FileRecord[] | null = null;
  // Cache hit/miss counters surfaced via getCacheStats() — used by
  // sverklo_status to give the user concrete evidence the cache is
  // doing its job. Dogfood perf review 2026-05-14 flagged the
  // observability gap: "cannot directly observe cache hits."
  private cacheHits = 0;
  private cacheMisses = 0;

  constructor(private db: Database) {
    // INSERT OR REPLACE used to be the implementation here, and it had a
    // silent data-corruption bug: REPLACE deletes the old row before
    // inserting the new one, which fires ON DELETE CASCADE on every
    // dependency edge that referenced this file as either source OR
    // target. buildGraph only restores OUTGOING edges (the ones the
    // re-parsed file declares); INCOMING edges from cached files were
    // wiped permanently. Symptom: sv-p4-04 — chunk-store.ts reported 0
    // importers when in fact indexer.ts imports it. Fix: ON CONFLICT
    // DO UPDATE mutates the row in place. Same id, no cascade, edges live.
    // The RETURNING id clause lets us still hand back the row id whether
    // the operation was an insert or an update.
    // Note we deliberately do NOT update pagerank on conflict —
    // buildGraph recomputes it once at the end of indexing.
    this.insertStmt = db.prepare(`
      INSERT INTO files (path, language, hash, last_modified, size_bytes, pagerank, indexed_at)
      VALUES (?, ?, ?, ?, ?, 0.0, ?)
      ON CONFLICT(path) DO UPDATE SET
        language = excluded.language,
        hash = excluded.hash,
        last_modified = excluded.last_modified,
        size_bytes = excluded.size_bytes,
        indexed_at = excluded.indexed_at
      RETURNING id
    `);
    this.getByPathStmt = db.prepare("SELECT * FROM files WHERE path = ?");
    this.getAllStmt = db.prepare("SELECT * FROM files ORDER BY pagerank DESC");
    this.deleteStmt = db.prepare("DELETE FROM files WHERE path = ?");
    this.updatePagerankStmt = db.prepare(
      "UPDATE files SET pagerank = ? WHERE id = ?"
    );
    this.getLanguagesStmt = db.prepare(
      "SELECT DISTINCT language FROM files WHERE language IS NOT NULL"
    );
  }

  upsert(
    path: string,
    language: string | null,
    hash: string,
    lastModified: number,
    sizeBytes: number
  ): number {
    const row = this.insertStmt.get(
      path,
      language,
      hash,
      lastModified,
      sizeBytes,
      Date.now()
    ) as { id: number };
    this.cachedAll = null;
    return row.id;
  }

  getByPath(path: string): FileRecord | undefined {
    return this.getByPathStmt.get(path) as unknown as FileRecord | undefined;
  }

  /**
   * Lenient lookup: try the path verbatim, then strip leading "./",
   * then try as a suffix (handles cases where callers pass a path
   * prefixed with the project name like "sverklo/src/foo.ts" against
   * an index that stores "src/foo.ts"). Returns the first match.
   * Suffix lookup requires a `/` boundary before the suffix to avoid
   * "foo.ts" accidentally matching "barfoo.ts".
   *
   * Dogfood T5 (architectural review 2026-05-13): path-format
   * inconsistency across deps / refs / impact tools made the suggested
   * input format from one tool fail in another.
   */
  findByPath(path: string): FileRecord | undefined {
    if (!path) return undefined;
    // Reject pathological inputs early. Anything over a couple hundred
    // chars isn't a real path — likely a probe or accident.
    if (path.length > 1024) return undefined;
    const direct = this.getByPath(path);
    if (direct) return direct;

    const trimmed = path.replace(/^\.\/+/, "").replace(/\/+$/, "");
    if (trimmed !== path) {
      const hit = this.getByPath(trimmed);
      if (hit) return hit;
    }

    // Try as a project-prefixed path (e.g. "myrepo/src/foo.ts" against
    // an index that stores "src/foo.ts"). We use a LIKE query with an
    // explicit escape character because SQLite GLOB treats `*`, `?`,
    // `[`, `]` as wildcards in BOUND parameters — passing user input
    // verbatim as a GLOB pattern is a wildcard-injection sink that
    // lets `path=*` enumerate every file in the index. Dogfood security
    // review 2026-05-14 (Issue A) flagged this against v0.20.25's
    // original GLOB implementation.
    //
    // LIKE with `ESCAPE '\'`:
    //   - escape `% _ \` in the user input so they're literal
    //   - construct the pattern `%/<escaped>` so the slash-prefix
    //     match is enforced
    const escapedSuffix = trimmed.replace(/[\\%_]/g, "\\$&");
    const pattern = `%/${escapedSuffix}`;
    const row = this.db
      .prepare("SELECT * FROM files WHERE path LIKE ? ESCAPE '\\' LIMIT 1")
      .get(pattern) as unknown as FileRecord | undefined;
    return row;
  }

  getAll(): FileRecord[] {
    if (this.cachedAll !== null) {
      this.cacheHits++;
      return this.cachedAll;
    }
    this.cacheMisses++;
    this.cachedAll = this.getAllStmt.all() as unknown as FileRecord[];
    return this.cachedAll;
  }

  /**
   * Return cache hit/miss counters so sverklo_status can surface them.
   * Hit rate = hits / (hits + misses) is the most actionable single
   * number — high rate means the cache is doing its job; near-zero
   * means callers are invalidating it too aggressively (or the cache
   * isn't being reached because of architecture above it).
   */
  getCacheStats(): { hits: number; misses: number; hitRate: number } {
    const total = this.cacheHits + this.cacheMisses;
    const hitRate = total === 0 ? 0 : this.cacheHits / total;
    return { hits: this.cacheHits, misses: this.cacheMisses, hitRate };
  }

  delete(path: string): void {
    this.deleteStmt.run(path);
    this.cachedAll = null;
  }

  updatePagerank(id: number, score: number): void {
    this.updatePagerankStmt.run(score, id);
    this.cachedAll = null;
  }

  /**
   * Drop the snapshot. Call after bulk operations (transactions,
   * migrations) that mutate the files table without going through the
   * upsert/delete/updatePagerank methods. Cheap no-op if already null.
   */
  invalidateCache(): void {
    this.cachedAll = null;
  }

  getLanguages(): string[] {
    return (this.getLanguagesStmt.all() as { language: string }[]).map(
      (r) => r.language
    );
  }

  count(): number {
    return (
      this.db.prepare("SELECT COUNT(*) as c FROM files").get() as { c: number }
    ).c;
  }
}

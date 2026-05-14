import type Database from "better-sqlite3";
import type { FileRecord } from "../types/index.js";

export class FileStore {
  private insertStmt: Database.Statement;
  private getByPathStmt: Database.Statement;
  private getAllStmt: Database.Statement;
  private deleteStmt: Database.Statement;
  private updatePagerankStmt: Database.Statement;
  private getLanguagesStmt: Database.Statement;

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

  constructor(private db: Database.Database) {
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
    return this.getByPathStmt.get(path) as FileRecord | undefined;
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
    const direct = this.getByPath(path);
    if (direct) return direct;

    const trimmed = path.replace(/^\.\/+/, "");
    if (trimmed !== path) {
      const hit = this.getByPath(trimmed);
      if (hit) return hit;
    }

    // Suffix match for project-prefixed inputs. SQLite glob is faster
    // than a JS scan over getAll(); we anchor on `*/<suffix>` so
    // "src/foo.ts" doesn't match "barsrc/foo.ts".
    const suffix = `*/${trimmed}`;
    const row = this.db
      .prepare("SELECT * FROM files WHERE path GLOB ? LIMIT 1")
      .get(suffix) as FileRecord | undefined;
    return row;
  }

  getAll(): FileRecord[] {
    if (this.cachedAll !== null) return this.cachedAll;
    this.cachedAll = this.getAllStmt.all() as FileRecord[];
    return this.cachedAll;
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

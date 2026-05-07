import type Database from "better-sqlite3";
import type { FileRecord } from "../types/index.js";

export class FileStore {
  private insertStmt: Database.Statement;
  private getByPathStmt: Database.Statement;
  private getAllStmt: Database.Statement;
  private deleteStmt: Database.Statement;
  private updatePagerankStmt: Database.Statement;
  private getLanguagesStmt: Database.Statement;

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
    return row.id;
  }

  getByPath(path: string): FileRecord | undefined {
    return this.getByPathStmt.get(path) as FileRecord | undefined;
  }

  getAll(): FileRecord[] {
    return this.getAllStmt.all() as FileRecord[];
  }

  delete(path: string): void {
    this.deleteStmt.run(path);
  }

  updatePagerank(id: number, score: number): void {
    this.updatePagerankStmt.run(score, id);
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

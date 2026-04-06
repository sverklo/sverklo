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
    this.insertStmt = db.prepare(`
      INSERT OR REPLACE INTO files (path, language, hash, last_modified, size_bytes, pagerank, indexed_at)
      VALUES (?, ?, ?, ?, ?, 0.0, ?)
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
    const result = this.insertStmt.run(
      path,
      language,
      hash,
      lastModified,
      sizeBytes,
      Date.now()
    );
    return Number(result.lastInsertRowid);
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

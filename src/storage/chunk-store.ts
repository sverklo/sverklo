import type Database from "better-sqlite3";
import type { CodeChunk, ChunkType } from "../types/index.js";

export class ChunkStore {
  private insertStmt: Database.Statement;
  private getByFileStmt: Database.Statement;
  private deleteByFileStmt: Database.Statement;
  private searchFtsStmt: Database.Statement;
  private getByIdStmt: Database.Statement;
  private getByNameStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.insertStmt = db.prepare(`
      INSERT INTO chunks (file_id, type, name, signature, start_line, end_line, content, description, token_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.getByFileStmt = db.prepare(
      "SELECT * FROM chunks WHERE file_id = ? ORDER BY start_line"
    );
    this.deleteByFileStmt = db.prepare("DELETE FROM chunks WHERE file_id = ?");
    this.searchFtsStmt = db.prepare(`
      SELECT c.*, rank
      FROM chunks_fts fts
      JOIN chunks c ON c.id = fts.rowid
      WHERE chunks_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `);
    this.getByIdStmt = db.prepare("SELECT * FROM chunks WHERE id = ?");
    this.getByNameStmt = db.prepare(`
      SELECT * FROM chunks WHERE name LIKE ? COLLATE NOCASE ORDER BY name LIMIT ?
    `);
  }

  insert(
    fileId: number,
    type: ChunkType,
    name: string | null,
    signature: string | null,
    startLine: number,
    endLine: number,
    content: string,
    description: string | null,
    tokenCount: number
  ): number {
    const result = this.insertStmt.run(
      fileId,
      type,
      name,
      signature,
      startLine,
      endLine,
      content,
      description,
      tokenCount
    );
    return Number(result.lastInsertRowid);
  }

  getByFile(fileId: number): CodeChunk[] {
    return this.getByFileStmt.all(fileId) as CodeChunk[];
  }

  deleteByFile(fileId: number): void {
    this.deleteByFileStmt.run(fileId);
  }

  searchFts(query: string, limit: number = 50): (CodeChunk & { rank: number })[] {
    try {
      // Escape FTS5 special chars and use simple matching
      const safeQuery = query
        .replace(/["'(){}[\]*:^~!@#$%&]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 1)
        .map((w) => `"${w}"`)
        .join(" OR ");
      if (!safeQuery) return [];
      return this.searchFtsStmt.all(safeQuery, limit) as (CodeChunk & {
        rank: number;
      })[];
    } catch {
      return [];
    }
  }

  getById(id: number): CodeChunk | undefined {
    return this.getByIdStmt.get(id) as CodeChunk | undefined;
  }

  getByName(namePattern: string, limit: number = 20): CodeChunk[] {
    return this.getByNameStmt.all(`%${namePattern}%`, limit) as CodeChunk[];
  }

  /**
   * Same shape as getByName, but JOINs in the containing file's path and
   * pagerank in a single indexed query so callers don't need to follow
   * up with a full fileStore.getAll() scan. Issue #6: the first-call
   * latency on sverklo_lookup was dominated by that scan warming up
   * prepared statements over the files table.
   */
  getByNameWithFile(
    namePattern: string,
    limit: number = 20
  ): (CodeChunk & { filePath: string; pagerank: number; fileLanguage: string })[] {
    return this.db
      .prepare(
        `SELECT c.*, f.path as filePath, f.pagerank, f.language as fileLanguage
         FROM chunks c JOIN files f ON c.file_id = f.id
         WHERE c.name LIKE ?
         ORDER BY f.pagerank DESC
         LIMIT ?`
      )
      .all(`%${namePattern}%`, limit) as (CodeChunk & {
      filePath: string;
      pagerank: number;
      fileLanguage: string;
    })[];
  }

  count(): number {
    return (
      this.db.prepare("SELECT COUNT(*) as c FROM chunks").get() as { c: number }
    ).c;
  }

  getAllWithFile(): (CodeChunk & { filePath: string; pagerank: number })[] {
    return this.db
      .prepare(
        `SELECT c.*, f.path as filePath, f.pagerank
         FROM chunks c JOIN files f ON c.file_id = f.id
         ORDER BY f.pagerank DESC, c.start_line`
      )
      .all() as (CodeChunk & { filePath: string; pagerank: number })[];
  }
}

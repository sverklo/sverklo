import type { Database, Statement } from "./database.js";
import type { CodeChunk, ChunkType } from "../types/index.js";

export class ChunkStore {
  private insertStmt: Statement;
  private getByFileStmt: Statement;
  private deleteByFileStmt: Statement;
  private searchFtsStmt: Statement;
  private getByIdStmt: Statement;
  private getByNameStmt: Statement;

  constructor(private db: Database) {
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
    return this.getByFileStmt.all(fileId) as unknown as CodeChunk[];
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
      return this.searchFtsStmt.all(safeQuery, limit) as unknown as (CodeChunk & {
        rank: number;
      })[];
    } catch {
      return [];
    }
  }

  getById(id: number): CodeChunk | undefined {
    return this.getByIdStmt.get(id) as unknown as CodeChunk | undefined;
  }

  /**
   * Batched fetch by a set of chunk ids. Used by hybrid-search to enrich
   * the RRF candidate set in one query instead of N point reads. The
   * `WHERE id IN (...)` shape is built dynamically because better-sqlite3
   * doesn't support array binding; we cap chunk-count at MAX_CANDIDATES
   * (~500) upstream so the SQL stays well under SQLITE_MAX_VARIABLE_NUMBER.
   * Returns chunks in arbitrary order — caller is responsible for the
   * (chunkId → CodeChunk) mapping if ordering matters.
   */
  getByIds(ids: number[]): CodeChunk[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(",");
    return this.db
      .prepare(`SELECT * FROM chunks WHERE id IN (${placeholders})`)
      .all(...ids) as unknown as CodeChunk[];
  }

  getByName(namePattern: string, limit: number = 20): CodeChunk[] {
    return this.getByNameStmt.all(`%${namePattern}%`, limit) as unknown as CodeChunk[];
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
    // Match-quality sort: exact match first, then prefix match, then
    // substring. Without this, looking up `map` on lodash returns
    // `arrayMap`, `mapToArray`, `MapCache` etc. ranked by file
    // pagerank — burying the actual `map` function past the lookup's
    // result limit. Bench P1 on lodash went 0/10 → 9/10 once this
    // was added on top of the parser fix.
    return this.db
      .prepare(
        `SELECT c.*, f.path as filePath, f.pagerank, f.language as fileLanguage,
                CASE
                  WHEN c.name = ? THEN 0
                  WHEN c.name LIKE ? THEN 1
                  ELSE 2
                END as match_quality
         FROM chunks c JOIN files f ON c.file_id = f.id
         WHERE c.name LIKE ?
         ORDER BY match_quality ASC, f.pagerank DESC
         LIMIT ?`
      )
      .all(namePattern, `${namePattern}%`, `%${namePattern}%`, limit) as unknown as (CodeChunk & {
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

  /** Update the purpose field on a chunk (P1-12). */
  updatePurpose(chunkId: number, purpose: string | null): void {
    this.db.prepare("UPDATE chunks SET purpose = ? WHERE id = ?").run(purpose, chunkId);
  }

  /** Read just the purpose for a chunk — cheap query path used by the
   * enrichment cache check. */
  getPurpose(chunkId: number): string | null {
    const row = this.db
      .prepare("SELECT purpose FROM chunks WHERE id = ?")
      .get(chunkId) as { purpose: string | null } | undefined;
    return row?.purpose ?? null;
  }

  getAllWithFile(): (CodeChunk & { filePath: string; pagerank: number })[] {
    return this.db
      .prepare(
        `SELECT c.*, f.path as filePath, f.pagerank
         FROM chunks c JOIN files f ON c.file_id = f.id
         ORDER BY f.pagerank DESC, c.start_line`
      )
      .all() as unknown as (CodeChunk & { filePath: string; pagerank: number })[];
  }
}

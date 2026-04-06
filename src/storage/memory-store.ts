import type Database from "better-sqlite3";
import type { Memory, MemoryCategory } from "../types/index.js";

export class MemoryStore {
  private insertStmt: Database.Statement;
  private getByIdStmt: Database.Statement;
  private getAllStmt: Database.Statement;
  private getByCategoryStmt: Database.Statement;
  private deleteStmt: Database.Statement;
  private updateStmt: Database.Statement;
  private searchFtsStmt: Database.Statement;
  private touchAccessStmt: Database.Statement;
  private markStaleStmt: Database.Statement;
  private getStaleStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.insertStmt = db.prepare(`
      INSERT INTO memories (category, content, tags, confidence, git_sha, git_branch, related_files, created_at, updated_at, last_accessed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.getByIdStmt = db.prepare("SELECT * FROM memories WHERE id = ?");
    this.getAllStmt = db.prepare("SELECT * FROM memories ORDER BY created_at DESC LIMIT ?");
    this.getByCategoryStmt = db.prepare(
      "SELECT * FROM memories WHERE category = ? ORDER BY created_at DESC LIMIT ?"
    );
    this.deleteStmt = db.prepare("DELETE FROM memories WHERE id = ?");
    this.updateStmt = db.prepare(
      "UPDATE memories SET content = ?, tags = ?, updated_at = ? WHERE id = ?"
    );
    this.searchFtsStmt = db.prepare(`
      SELECT m.*, rank
      FROM memories_fts fts
      JOIN memories m ON m.id = fts.rowid
      WHERE memories_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `);
    this.touchAccessStmt = db.prepare(
      "UPDATE memories SET last_accessed = ?, access_count = access_count + 1 WHERE id = ?"
    );
    this.markStaleStmt = db.prepare(
      "UPDATE memories SET is_stale = ? WHERE id = ?"
    );
    this.getStaleStmt = db.prepare(
      "SELECT * FROM memories WHERE is_stale = 1 ORDER BY created_at DESC"
    );
  }

  insert(
    category: MemoryCategory,
    content: string,
    tags: string[] | null,
    confidence: number,
    gitSha: string | null,
    gitBranch: string | null,
    relatedFiles: string[] | null
  ): number {
    const now = Date.now();
    const result = this.insertStmt.run(
      category,
      content,
      tags ? JSON.stringify(tags) : null,
      confidence,
      gitSha,
      gitBranch,
      relatedFiles ? JSON.stringify(relatedFiles) : null,
      now,
      now,
      now
    );
    return Number(result.lastInsertRowid);
  }

  getById(id: number): Memory | undefined {
    return this.getByIdStmt.get(id) as Memory | undefined;
  }

  getAll(limit: number = 50): Memory[] {
    return this.getAllStmt.all(limit) as Memory[];
  }

  getByCategory(category: MemoryCategory, limit: number = 50): Memory[] {
    return this.getByCategoryStmt.all(category, limit) as Memory[];
  }

  delete(id: number): boolean {
    const result = this.deleteStmt.run(id);
    return result.changes > 0;
  }

  update(id: number, content: string, tags?: string[]): void {
    this.updateStmt.run(
      content,
      tags ? JSON.stringify(tags) : null,
      Date.now(),
      id
    );
  }

  searchFts(query: string, limit: number = 20): (Memory & { rank: number })[] {
    try {
      const safeQuery = query
        .replace(/["'(){}[\]*:^~!@#$%&]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 1)
        .map((w) => `"${w}"`)
        .join(" OR ");
      if (!safeQuery) return [];
      return this.searchFtsStmt.all(safeQuery, limit) as (Memory & { rank: number })[];
    } catch {
      return [];
    }
  }

  touchAccess(id: number): void {
    this.touchAccessStmt.run(Date.now(), id);
  }

  markStale(id: number, stale: boolean): void {
    this.markStaleStmt.run(stale ? 1 : 0, id);
  }

  getStale(): Memory[] {
    return this.getStaleStmt.all() as Memory[];
  }

  count(): number {
    return (
      this.db.prepare("SELECT COUNT(*) as c FROM memories").get() as { c: number }
    ).c;
  }
}

import type Database from "better-sqlite3";
import type { Memory, MemoryCategory, MemoryTier } from "../types/index.js";

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
  private invalidateStmt: Database.Statement;
  private getCoreStmt: Database.Statement;
  private setTierStmt: Database.Statement;
  private getActiveStmt: Database.Statement;
  private setPinsStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.insertStmt = db.prepare(`
      INSERT INTO memories (category, content, tags, confidence, git_sha, git_branch, related_files, created_at, updated_at, last_accessed, tier, valid_from_sha)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.getByIdStmt = db.prepare("SELECT * FROM memories WHERE id = ?");
    // Active = not invalidated (valid_until_sha IS NULL)
    this.getAllStmt = db.prepare("SELECT * FROM memories WHERE valid_until_sha IS NULL ORDER BY created_at DESC LIMIT ?");
    this.getByCategoryStmt = db.prepare(
      "SELECT * FROM memories WHERE category = ? AND valid_until_sha IS NULL ORDER BY created_at DESC LIMIT ?"
    );
    this.deleteStmt = db.prepare("DELETE FROM memories WHERE id = ?");
    this.updateStmt = db.prepare(
      "UPDATE memories SET content = ?, tags = ?, updated_at = ? WHERE id = ?"
    );
    this.searchFtsStmt = db.prepare(`
      SELECT m.*, rank
      FROM memories_fts fts
      JOIN memories m ON m.id = fts.rowid
      WHERE memories_fts MATCH ? AND m.valid_until_sha IS NULL
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
      "SELECT * FROM memories WHERE is_stale = 1 AND valid_until_sha IS NULL ORDER BY created_at DESC"
    );
    // Bi-temporal: invalidate a memory (mark superseded) instead of deleting
    this.invalidateStmt = db.prepare(`
      UPDATE memories
      SET valid_until_sha = ?, invalidated_at = ?, superseded_by = ?
      WHERE id = ?
    `);
    // Core memories for auto-injection
    this.getCoreStmt = db.prepare(`
      SELECT * FROM memories
      WHERE tier = 'core' AND valid_until_sha IS NULL
      ORDER BY confidence DESC, access_count DESC
      LIMIT ?
    `);
    this.setTierStmt = db.prepare("UPDATE memories SET tier = ? WHERE id = ?");
    this.getActiveStmt = db.prepare(
      "SELECT * FROM memories WHERE valid_until_sha IS NULL ORDER BY created_at DESC LIMIT ?"
    );
    this.setPinsStmt = db.prepare("UPDATE memories SET pins = ? WHERE id = ?");
  }

  insert(
    category: MemoryCategory,
    content: string,
    tags: string[] | null,
    confidence: number,
    gitSha: string | null,
    gitBranch: string | null,
    relatedFiles: string[] | null,
    tier: MemoryTier = "archive"
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
      now,
      tier,
      gitSha
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

  /**
   * Bi-temporal invalidation — marks a memory as superseded rather than deleting it.
   * Preserves history so users can query "what we believed at commit X".
   */
  invalidate(id: number, currentSha: string | null, supersededBy: number | null = null): void {
    this.invalidateStmt.run(currentSha, Date.now(), supersededBy, id);
  }

  getCore(limit: number = 10): Memory[] {
    return this.getCoreStmt.all(limit) as Memory[];
  }

  setTier(id: number, tier: MemoryTier): void {
    this.setTierStmt.run(tier, id);
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

  setPins(id: number, pins: string[]): void {
    this.setPinsStmt.run(pins.length > 0 ? JSON.stringify(pins) : null, id);
  }

  /**
   * Find active memories pinned to a given target (file path or symbol name).
   * Scans the `pins` JSON array column with a LIKE match.
   */
  getByPin(target: string, limit: number = 20): Memory[] {
    // Use LIKE to find the target inside the JSON array string.
    // This is simple and correct for reasonable pin counts.
    return this.db
      .prepare(
        `SELECT * FROM memories
         WHERE pins LIKE ? AND valid_until_sha IS NULL
         ORDER BY confidence DESC, created_at DESC
         LIMIT ?`
      )
      .all(`%"${target.replace(/[%_"]/g, "")}"%`, limit) as Memory[];
  }

  count(): number {
    return (
      this.db.prepare("SELECT COUNT(*) as c FROM memories WHERE valid_until_sha IS NULL").get() as { c: number }
    ).c;
  }

  /**
   * Returns all memories including invalidated ones, for bi-temporal timeline views.
   */
  getTimeline(limit: number = 500): Memory[] {
    return this.db
      .prepare("SELECT * FROM memories ORDER BY created_at DESC LIMIT ?")
      .all(limit) as Memory[];
  }
}

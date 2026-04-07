import type Database from "better-sqlite3";

export interface SymbolRef {
  id: number;
  source_chunk_id: number;
  target_name: string;
  line: number | null;
}

export interface ImpactResult {
  chunk_id: number;
  chunk_name: string | null;
  chunk_type: string;
  file_path: string;
  start_line: number;
  end_line: number;
  ref_line: number | null;
}

export class SymbolRefStore {
  private insertStmt: Database.Statement;
  private deleteByChunkStmt: Database.Statement;
  private getImpactStmt: Database.Statement;
  private getCallersStmt: Database.Statement;
  private getAllStmt: Database.Statement;
  private countStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.insertStmt = db.prepare(`
      INSERT OR IGNORE INTO symbol_refs (source_chunk_id, target_name, line)
      VALUES (?, ?, ?)
    `);
    this.deleteByChunkStmt = db.prepare(
      "DELETE FROM symbol_refs WHERE source_chunk_id = ?"
    );
    // Impact: find all chunks that reference a given symbol name,
    // joined with their file + chunk metadata for direct display
    this.getImpactStmt = db.prepare(`
      SELECT
        c.id as chunk_id,
        c.name as chunk_name,
        c.type as chunk_type,
        c.start_line,
        c.end_line,
        f.path as file_path,
        sr.line as ref_line
      FROM symbol_refs sr
      JOIN chunks c ON c.id = sr.source_chunk_id
      JOIN files f ON f.id = c.file_id
      WHERE sr.target_name = ?
      ORDER BY f.pagerank DESC
      LIMIT ?
    `);
    this.getCallersStmt = db.prepare(`
      SELECT COUNT(*) as c FROM symbol_refs WHERE target_name = ?
    `);
    this.getAllStmt = db.prepare("SELECT * FROM symbol_refs");
    this.countStmt = db.prepare("SELECT COUNT(*) as c FROM symbol_refs");
  }

  insert(sourceChunkId: number, targetName: string, line: number | null = null): void {
    this.insertStmt.run(sourceChunkId, targetName, line);
  }

  deleteByChunk(chunkId: number): void {
    this.deleteByChunkStmt.run(chunkId);
  }

  getImpact(targetName: string, limit: number = 50): ImpactResult[] {
    return this.getImpactStmt.all(targetName, limit) as ImpactResult[];
  }

  getCallerCount(targetName: string): number {
    return (this.getCallersStmt.get(targetName) as { c: number }).c;
  }

  getAll(): SymbolRef[] {
    return this.getAllStmt.all() as SymbolRef[];
  }

  count(): number {
    return (this.countStmt.get() as { c: number }).c;
  }
}

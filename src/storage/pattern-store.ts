import type Database from "better-sqlite3";

// Closed taxonomy. Keep small so the LLM can't invent labels and the
// retrieval surface stays predictable. Anything outside this list is
// dropped during ingestion.
export const PATTERN_TAXONOMY = [
  // Creational
  "factory",
  "builder",
  "singleton",
  "prototype",
  "object_pool",
  // Structural
  "adapter",
  "decorator",
  "facade",
  "proxy",
  "composite",
  "bridge",
  "flyweight",
  // Behavioural
  "observer",
  "strategy",
  "command",
  "iterator",
  "state",
  "template_method",
  "visitor",
  "mediator",
  "chain_of_responsibility",
  "memento",
  // Architectural / DDD
  "repository",
  "service",
  "controller",
  "middleware",
  "validator",
  "serializer",
  "event_handler",
  "router",
  "store",
  "view",
] as const;

export type PatternName = (typeof PATTERN_TAXONOMY)[number];

export const PATTERN_SET: Set<string> = new Set(PATTERN_TAXONOMY);

export interface PatternEdge {
  id: number;
  chunk_id: number;
  pattern: string;
  role: string | null;
  confidence: number;
  content_hash: string;
  labeled_at: number;
}

export interface PatternEdgeInput {
  chunk_id: number;
  pattern: string;
  role: string | null;
  confidence: number;
  content_hash: string;
}

export interface PatternEdgeWithLocation extends PatternEdge {
  file_path: string;
  start_line: number;
  end_line: number;
  symbol_name: string | null;
  chunk_type: string;
}

export class PatternStore {
  private upsertStmt: Database.Statement;
  private deleteByChunkStmt: Database.Statement;
  private getByChunkStmt: Database.Statement;
  private getByPatternStmt: Database.Statement;
  private countStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.upsertStmt = db.prepare(`
      INSERT INTO pattern_edges
        (chunk_id, pattern, role, confidence, content_hash, labeled_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(chunk_id, pattern, role) DO UPDATE SET
        confidence = excluded.confidence,
        content_hash = excluded.content_hash,
        labeled_at = excluded.labeled_at
    `);
    this.deleteByChunkStmt = db.prepare("DELETE FROM pattern_edges WHERE chunk_id = ?");
    this.getByChunkStmt = db.prepare(
      "SELECT * FROM pattern_edges WHERE chunk_id = ? ORDER BY confidence DESC"
    );
    this.getByPatternStmt = db.prepare(`
      SELECT
        pe.id, pe.chunk_id, pe.pattern, pe.role, pe.confidence,
        pe.content_hash, pe.labeled_at,
        f.path  AS file_path,
        c.start_line, c.end_line, c.name AS symbol_name, c.type AS chunk_type
      FROM pattern_edges pe
      JOIN chunks c ON c.id = pe.chunk_id
      JOIN files  f ON f.id = c.file_id
      WHERE pe.pattern = ?
      ORDER BY pe.confidence DESC
      LIMIT ?
    `);
    this.countStmt = db.prepare("SELECT COUNT(*) as c FROM pattern_edges");
  }

  upsert(input: PatternEdgeInput, labeledAt = Date.now()): void {
    if (!PATTERN_SET.has(input.pattern)) return; // closed taxonomy
    this.upsertStmt.run(
      input.chunk_id,
      input.pattern,
      input.role,
      input.confidence,
      input.content_hash,
      labeledAt
    );
  }

  upsertMany(rows: PatternEdgeInput[]): void {
    const tx = this.db.transaction((batch: PatternEdgeInput[]) => {
      const t = Date.now();
      for (const r of batch) this.upsert(r, t);
    });
    tx(rows);
  }

  deleteForChunk(chunkId: number): void {
    this.deleteByChunkStmt.run(chunkId);
  }

  getByChunk(chunkId: number): PatternEdge[] {
    return this.getByChunkStmt.all(chunkId) as PatternEdge[];
  }

  getByPattern(pattern: string, limit = 50): PatternEdgeWithLocation[] {
    if (!PATTERN_SET.has(pattern)) return [];
    return this.getByPatternStmt.all(pattern, limit) as PatternEdgeWithLocation[];
  }

  count(): number {
    return (this.countStmt.get() as { c: number }).c;
  }
}

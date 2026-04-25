import type Database from "better-sqlite3";

export type DocMatchKind = "backtick" | "fenced_code" | "bare";
// Sprint 9 inclusion-vs-pointer split (iwe-org/iwe). The two kinds are:
// `includes` (structural section-of, fenced-code blocks naming the
// symbol) and `references` (associative see-also pointers via inline
// backticks or prose).
export type DocEdgeKind = "includes" | "references";

export interface DocMention {
  id: number;
  doc_chunk_id: number;
  target_symbol: string;
  target_chunk_id: number | null;
  match_kind: DocMatchKind;
  edge_kind: DocEdgeKind;
  confidence: number;
}

export interface DocMentionInput {
  doc_chunk_id: number;
  target_symbol: string;
  target_chunk_id: number | null;
  match_kind: DocMatchKind;
  edge_kind?: DocEdgeKind;
  confidence: number;
}

export interface DocMentionWithDoc extends DocMention {
  doc_file_path: string;
  doc_start_line: number;
  doc_end_line: number;
  doc_breadcrumb: string | null;
}

// Default mapping when callers don't pass edge_kind explicitly. The
// reasoning: a fenced-code block that names the symbol is
// structurally documenting it (the doc section "contains" it). Inline
// backticks and bare prose mentions are see-also pointers.
export function defaultEdgeKindFor(match: DocMatchKind): DocEdgeKind {
  return match === "fenced_code" ? "includes" : "references";
}

export class DocEdgeStore {
  private insertStmt: Database.Statement;
  private deleteByDocStmt: Database.Statement;
  private getBySymbolStmt: Database.Statement;
  private getByChunkStmt: Database.Statement;
  private countStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.insertStmt = db.prepare(`
      INSERT OR REPLACE INTO doc_mentions
        (doc_chunk_id, target_symbol, target_chunk_id, match_kind, edge_kind, confidence)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    this.deleteByDocStmt = db.prepare(
      "DELETE FROM doc_mentions WHERE doc_chunk_id = ?"
    );
    // Join the doc chunk + its file so callers can render a meaningful
    // breadcrumb without a second query.
    this.getBySymbolStmt = db.prepare(`
      SELECT
        dm.id,
        dm.doc_chunk_id,
        dm.target_symbol,
        dm.target_chunk_id,
        dm.match_kind,
        dm.edge_kind,
        dm.confidence,
        dc.start_line as doc_start_line,
        dc.end_line   as doc_end_line,
        dc.signature  as doc_breadcrumb,
        df.path       as doc_file_path
      FROM doc_mentions dm
      JOIN chunks dc ON dc.id = dm.doc_chunk_id
      JOIN files  df ON df.id = dc.file_id
      WHERE dm.target_symbol = ?
      ORDER BY dm.confidence DESC
      LIMIT ?
    `);
    this.getByChunkStmt = db.prepare(`
      SELECT
        id, doc_chunk_id, target_symbol, target_chunk_id, match_kind, edge_kind, confidence
      FROM doc_mentions
      WHERE target_chunk_id = ?
    `);
    this.countStmt = db.prepare("SELECT COUNT(*) as c FROM doc_mentions");
  }

  insert(m: DocMentionInput): void {
    const edgeKind = m.edge_kind ?? defaultEdgeKindFor(m.match_kind);
    this.insertStmt.run(
      m.doc_chunk_id,
      m.target_symbol,
      m.target_chunk_id,
      m.match_kind,
      edgeKind,
      m.confidence
    );
  }

  /**
   * Filter doc mentions for a symbol by edge kind. `includes` returns
   * structural section-of links (the doc section documents the symbol);
   * `references` returns associative see-also mentions.
   */
  getBySymbolByKind(symbol: string, edgeKind: DocEdgeKind, limit = 20): DocMentionWithDoc[] {
    return this.db
      .prepare(`
        SELECT
          dm.id,
          dm.doc_chunk_id,
          dm.target_symbol,
          dm.target_chunk_id,
          dm.match_kind,
          dm.edge_kind,
          dm.confidence,
          dc.start_line as doc_start_line,
          dc.end_line   as doc_end_line,
          dc.signature  as doc_breadcrumb,
          df.path       as doc_file_path
        FROM doc_mentions dm
        JOIN chunks dc ON dc.id = dm.doc_chunk_id
        JOIN files  df ON df.id = dc.file_id
        WHERE dm.target_symbol = ? AND dm.edge_kind = ?
        ORDER BY dm.confidence DESC
        LIMIT ?
      `)
      .all(symbol, edgeKind, limit) as DocMentionWithDoc[];
  }

  insertMany(inputs: DocMentionInput[]): void {
    if (inputs.length === 0) return;
    const tx = this.db.transaction((rows: DocMentionInput[]) => {
      for (const r of rows) this.insert(r);
    });
    tx(inputs);
  }

  deleteForDocChunk(docChunkId: number): void {
    this.deleteByDocStmt.run(docChunkId);
  }

  /**
   * All doc chunks that mention the given symbol. Returns up to `limit`
   * rows, highest-confidence first.
   */
  getBySymbol(symbol: string, limit = 20): DocMentionWithDoc[] {
    return this.getBySymbolStmt.all(symbol, limit) as DocMentionWithDoc[];
  }

  /**
   * All doc mentions that resolved to a specific chunk id.
   */
  getByChunkId(chunkId: number): DocMention[] {
    return this.getByChunkStmt.all(chunkId) as DocMention[];
  }

  count(): number {
    return (this.countStmt.get() as { c: number }).c;
  }
}

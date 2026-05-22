import type { Database, Statement } from "./database.js";

export interface EmbeddingWithMeta {
  chunk_id: number;
  vector: Float32Array;
  chunk_type: string;
  file_id: number;
}

export class EmbeddingStore {
  private insertStmt: Statement;
  private getStmt: Statement;
  private getAllStmt: Statement;
  private getAllWithMetaStmt: Statement;
  private deleteByChunkStmt: Statement;

  constructor(private db: Database) {
    this.insertStmt = db.prepare(
      "INSERT OR REPLACE INTO embeddings (chunk_id, vector) VALUES (?, ?)"
    );
    this.getStmt = db.prepare(
      "SELECT vector FROM embeddings WHERE chunk_id = ?"
    );
    this.getAllStmt = db.prepare("SELECT chunk_id, vector FROM embeddings");
    this.getAllWithMetaStmt = db.prepare(
      // JOIN against chunks once so callers can scope-filter / type-bucket
      // without a per-row chunkStore.getById round-trip. Used by the
      // broadcast vector-search path (search/investigate.ts).
      `SELECT e.chunk_id, e.vector, c.type AS chunk_type, c.file_id
       FROM embeddings e
       JOIN chunks c ON c.id = e.chunk_id`
    );
    this.deleteByChunkStmt = db.prepare(
      "DELETE FROM embeddings WHERE chunk_id = ?"
    );
  }

  insert(chunkId: number, vector: Float32Array): void {
    this.insertStmt.run(chunkId, Buffer.from(vector.buffer));
  }

  get(chunkId: number): Float32Array | undefined {
    const row = this.getStmt.get(chunkId) as
      | { vector: Buffer }
      | undefined;
    if (!row) return undefined;
    return new Float32Array(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength / 4);
  }

  getAll(): Map<number, Float32Array> {
    const map = new Map<number, Float32Array>();
    const rows = this.getAllStmt.all() as {
      chunk_id: number;
      vector: Buffer;
    }[];
    for (const row of rows) {
      // Copy buffer to avoid shared buffer issues
      const arr = new Float32Array(row.vector.length / 4);
      const view = new Float32Array(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength / 4);
      arr.set(view);
      map.set(row.chunk_id, arr);
    }
    return map;
  }

  /**
   * Broadcast scan that JOINs embeddings with chunk metadata in one
   * SQLite query. Avoids the N+1 pattern in callers that need to
   * score every vector AND know each chunk's type/file_id (e.g. the
   * runVectorSplit code/doc split in search/investigate.ts).
   */
  getAllWithMeta(): EmbeddingWithMeta[] {
    const rows = this.getAllWithMetaStmt.all() as {
      chunk_id: number;
      vector: Buffer;
      chunk_type: string;
      file_id: number;
    }[];
    const out: EmbeddingWithMeta[] = new Array(rows.length);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const arr = new Float32Array(row.vector.length / 4);
      const view = new Float32Array(
        row.vector.buffer,
        row.vector.byteOffset,
        row.vector.byteLength / 4,
      );
      arr.set(view);
      out[i] = {
        chunk_id: row.chunk_id,
        vector: arr,
        chunk_type: row.chunk_type,
        file_id: row.file_id,
      };
    }
    return out;
  }

  delete(chunkId: number): void {
    this.deleteByChunkStmt.run(chunkId);
  }

  count(): number {
    return (
      this.db.prepare("SELECT COUNT(*) as c FROM embeddings").get() as {
        c: number;
      }
    ).c;
  }

  /**
   * Read the dimension of one stored vector (any row). Returns null if
   * the table is empty. Used by sverklo doctor / status to surface
   * dim mismatches against the configured provider (#59 / #60).
   *
   * Cheap: SELECT … LIMIT 1, then divide blob length by 4 (Float32).
   */
  dimensionsObserved(): number | null {
    const row = this.db
      .prepare("SELECT length(vector) AS bytes FROM embeddings LIMIT 1")
      .get() as { bytes: number } | undefined;
    if (!row || row.bytes === 0) return null;
    return Math.floor(row.bytes / 4);
  }
}

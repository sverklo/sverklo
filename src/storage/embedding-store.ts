import type Database from "better-sqlite3";

export class EmbeddingStore {
  private insertStmt: Database.Statement;
  private getStmt: Database.Statement;
  private getAllStmt: Database.Statement;
  private deleteByChunkStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.insertStmt = db.prepare(
      "INSERT OR REPLACE INTO embeddings (chunk_id, vector) VALUES (?, ?)"
    );
    this.getStmt = db.prepare(
      "SELECT vector FROM embeddings WHERE chunk_id = ?"
    );
    this.getAllStmt = db.prepare("SELECT chunk_id, vector FROM embeddings");
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
}

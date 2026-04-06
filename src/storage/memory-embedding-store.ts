import type Database from "better-sqlite3";

export class MemoryEmbeddingStore {
  private insertStmt: Database.Statement;
  private getStmt: Database.Statement;
  private getAllStmt: Database.Statement;
  private deleteStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.insertStmt = db.prepare(
      "INSERT OR REPLACE INTO memory_embeddings (memory_id, vector) VALUES (?, ?)"
    );
    this.getStmt = db.prepare(
      "SELECT vector FROM memory_embeddings WHERE memory_id = ?"
    );
    this.getAllStmt = db.prepare(
      "SELECT memory_id, vector FROM memory_embeddings"
    );
    this.deleteStmt = db.prepare(
      "DELETE FROM memory_embeddings WHERE memory_id = ?"
    );
  }

  insert(memoryId: number, vector: Float32Array): void {
    this.insertStmt.run(memoryId, Buffer.from(vector.buffer));
  }

  get(memoryId: number): Float32Array | undefined {
    const row = this.getStmt.get(memoryId) as { vector: Buffer } | undefined;
    if (!row) return undefined;
    return new Float32Array(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength / 4);
  }

  getAll(): Map<number, Float32Array> {
    const map = new Map<number, Float32Array>();
    const rows = this.getAllStmt.all() as { memory_id: number; vector: Buffer }[];
    for (const row of rows) {
      const arr = new Float32Array(row.vector.length / 4);
      const view = new Float32Array(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength / 4);
      arr.set(view);
      map.set(row.memory_id, arr);
    }
    return map;
  }

  delete(memoryId: number): void {
    this.deleteStmt.run(memoryId);
  }
}

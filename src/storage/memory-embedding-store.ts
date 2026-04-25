import type Database from "better-sqlite3";

function rowToVector(buf: Buffer): Float32Array {
  // Copy into a fresh Float32Array so the caller doesn't hold a view
  // into a reused better-sqlite3 buffer.
  const view = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const arr = new Float32Array(view.length);
  arr.set(view);
  return arr;
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

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
    return rowToVector(row.vector);
  }

  /**
   * Materialise the full embedding map. Eats memory linearly with the
   * memory count — only call this when you actually need every vector
   * (e.g. cluster-mode `prune`). Hot retrieval paths should use
   * `findTopK` / `getMany` instead.
   */
  getAll(): Map<number, Float32Array> {
    const map = new Map<number, Float32Array>();
    const rows = this.getAllStmt.all() as { memory_id: number; vector: Buffer }[];
    for (const row of rows) {
      map.set(row.memory_id, rowToVector(row.vector));
    }
    return map;
  }

  /**
   * Stream every embedding through cosine similarity against `query`
   * and return the top-K matches. Constant-memory in K rather than
   * linear in the table size — this is what `recall` and `remember`
   * should use when they only need the highest-similarity rows.
   */
  findTopK(
    query: Float32Array,
    k: number,
    minScore = 0
  ): Array<{ memoryId: number; score: number }> {
    if (k <= 0) return [];
    const heap: Array<{ memoryId: number; score: number }> = [];
    let worstIdx = -1;
    const iter = this.getAllStmt.iterate() as IterableIterator<{
      memory_id: number;
      vector: Buffer;
    }>;
    for (const row of iter) {
      const view = new Float32Array(
        row.vector.buffer,
        row.vector.byteOffset,
        row.vector.byteLength / 4
      );
      const score = cosine(query, view);
      if (score < minScore) continue;
      if (heap.length < k) {
        heap.push({ memoryId: row.memory_id, score });
        if (heap.length === k) {
          worstIdx = 0;
          for (let i = 1; i < heap.length; i++) {
            if (heap[i].score < heap[worstIdx].score) worstIdx = i;
          }
        }
      } else if (score > heap[worstIdx].score) {
        heap[worstIdx] = { memoryId: row.memory_id, score };
        worstIdx = 0;
        for (let i = 1; i < heap.length; i++) {
          if (heap[i].score < heap[worstIdx].score) worstIdx = i;
        }
      }
    }
    heap.sort((a, b) => b.score - a.score);
    return heap;
  }

  /**
   * Fetch a specific subset of embeddings by memory id. Used by `prune`,
   * which already has a bounded candidate set and doesn't need to load
   * the entire table. Batched to keep `?` placeholder count under the
   * SQLite limit.
   */
  getMany(ids: number[]): Map<number, Float32Array> {
    const map = new Map<number, Float32Array>();
    if (ids.length === 0) return map;
    const BATCH = 500;
    for (let i = 0; i < ids.length; i += BATCH) {
      const slice = ids.slice(i, i + BATCH);
      const placeholders = slice.map(() => "?").join(",");
      const rows = this.db
        .prepare(
          `SELECT memory_id, vector FROM memory_embeddings WHERE memory_id IN (${placeholders})`
        )
        .all(...slice) as { memory_id: number; vector: Buffer }[];
      for (const row of rows) {
        map.set(row.memory_id, rowToVector(row.vector));
      }
    }
    return map;
  }

  delete(memoryId: number): void {
    this.deleteStmt.run(memoryId);
  }
}

import type Database from "better-sqlite3";

export interface ConceptRecord {
  cluster_id: number;
  label: string;
  summary: string | null;
  tags: string | null;            // comma-separated
  hub_file: string | null;
  member_count: number;
  content_hash: string;
  labeled_at: number;
}

export interface ConceptInsert {
  cluster_id: number;
  label: string;
  summary: string | null;
  tags: string[];
  hub_file: string | null;
  member_count: number;
  content_hash: string;
}

export class ConceptStore {
  private upsertStmt: Database.Statement;
  private getStmt: Database.Statement;
  private getAllStmt: Database.Statement;
  private deleteStmt: Database.Statement;
  private upsertEmbeddingStmt: Database.Statement;
  private getEmbeddingStmt: Database.Statement;
  private getAllEmbeddingsStmt: Database.Statement;
  private countStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.upsertStmt = db.prepare(`
      INSERT INTO concepts
        (cluster_id, label, summary, tags, hub_file, member_count, content_hash, labeled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cluster_id) DO UPDATE SET
        label = excluded.label,
        summary = excluded.summary,
        tags = excluded.tags,
        hub_file = excluded.hub_file,
        member_count = excluded.member_count,
        content_hash = excluded.content_hash,
        labeled_at = excluded.labeled_at
    `);
    this.getStmt = db.prepare("SELECT * FROM concepts WHERE cluster_id = ?");
    this.getAllStmt = db.prepare("SELECT * FROM concepts ORDER BY member_count DESC");
    this.deleteStmt = db.prepare("DELETE FROM concepts WHERE cluster_id = ?");
    this.upsertEmbeddingStmt = db.prepare(
      "INSERT OR REPLACE INTO concept_embeddings (cluster_id, vector) VALUES (?, ?)"
    );
    this.getEmbeddingStmt = db.prepare(
      "SELECT vector FROM concept_embeddings WHERE cluster_id = ?"
    );
    this.getAllEmbeddingsStmt = db.prepare(
      "SELECT cluster_id, vector FROM concept_embeddings"
    );
    this.countStmt = db.prepare("SELECT COUNT(*) as c FROM concepts");
  }

  upsert(input: ConceptInsert, labeledAt: number = Date.now()): void {
    this.upsertStmt.run(
      input.cluster_id,
      input.label,
      input.summary,
      input.tags.length > 0 ? input.tags.join(",") : null,
      input.hub_file,
      input.member_count,
      input.content_hash,
      labeledAt
    );
  }

  get(clusterId: number): ConceptRecord | null {
    return (this.getStmt.get(clusterId) as ConceptRecord | undefined) ?? null;
  }

  getAll(): ConceptRecord[] {
    return this.getAllStmt.all() as ConceptRecord[];
  }

  delete(clusterId: number): void {
    this.deleteStmt.run(clusterId);
  }

  upsertEmbedding(clusterId: number, vector: Float32Array): void {
    this.upsertEmbeddingStmt.run(clusterId, Buffer.from(vector.buffer));
  }

  getEmbedding(clusterId: number): Float32Array | undefined {
    const row = this.getEmbeddingStmt.get(clusterId) as { vector: Buffer } | undefined;
    if (!row) return undefined;
    return new Float32Array(
      row.vector.buffer,
      row.vector.byteOffset,
      row.vector.byteLength / 4
    );
  }

  getAllEmbeddings(): Map<number, Float32Array> {
    const map = new Map<number, Float32Array>();
    const rows = this.getAllEmbeddingsStmt.all() as {
      cluster_id: number;
      vector: Buffer;
    }[];
    for (const row of rows) {
      const arr = new Float32Array(row.vector.length / 4);
      const view = new Float32Array(
        row.vector.buffer,
        row.vector.byteOffset,
        row.vector.byteLength / 4
      );
      arr.set(view);
      map.set(row.cluster_id, arr);
    }
    return map;
  }

  count(): number {
    return (this.countStmt.get() as { c: number }).c;
  }
}

/**
 * Content hash for a cluster — drives the "re-label on change" decision.
 * Uses sorted member ids + their chunk count as a fingerprint. If a cluster
 * gains/loses members the hash changes; otherwise we can skip re-labeling.
 */
export function clusterContentHash(memberFileIds: number[], memberChunkCount: number): string {
  const sorted = [...memberFileIds].sort((a, b) => a - b);
  return `${sorted.join(",")}|${memberChunkCount}`;
}

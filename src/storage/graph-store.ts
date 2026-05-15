import type { Database, Statement } from "./database.js";
import type { DependencyEdge } from "../types/index.js";

export class GraphStore {
  private upsertStmt: Statement;
  private getImportsStmt: Statement;
  private getImportersStmt: Statement;
  private deleteByFileStmt: Statement;
  private getAllStmt: Statement;

  constructor(private db: Database) {
    this.upsertStmt = db.prepare(`
      INSERT INTO dependencies (source_file_id, target_file_id, reference_count)
      VALUES (?, ?, ?)
      ON CONFLICT(source_file_id, target_file_id)
      DO UPDATE SET reference_count = excluded.reference_count
    `);
    this.getImportsStmt = db.prepare(
      "SELECT * FROM dependencies WHERE source_file_id = ?"
    );
    this.getImportersStmt = db.prepare(
      "SELECT * FROM dependencies WHERE target_file_id = ?"
    );
    this.deleteByFileStmt = db.prepare(
      "DELETE FROM dependencies WHERE source_file_id = ?"
    );
    this.getAllStmt = db.prepare("SELECT * FROM dependencies");
  }

  upsert(sourceFileId: number, targetFileId: number, refCount: number): void {
    this.upsertStmt.run(sourceFileId, targetFileId, refCount);
  }

  getImports(fileId: number): DependencyEdge[] {
    return this.getImportsStmt.all(fileId) as unknown as DependencyEdge[];
  }

  getImporters(fileId: number): DependencyEdge[] {
    return this.getImportersStmt.all(fileId) as unknown as DependencyEdge[];
  }

  deleteBySourceFile(fileId: number): void {
    this.deleteByFileStmt.run(fileId);
  }

  getAll(): DependencyEdge[] {
    return this.getAllStmt.all() as unknown as DependencyEdge[];
  }
}

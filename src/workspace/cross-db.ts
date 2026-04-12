import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface CrossProject {
  id: string;
  path: string;
  name: string;
  role: string;
  lastIndexedAt: number;
  gitSha: string;
}

export interface InterfaceContract {
  id?: number;
  projectId: string;
  interfaceType: string;
  sourceFile: string;
  symbolName: string;
  symbolKind: string;
  signature?: string;
  fileLine?: number;
  contentHash: string;
}

export interface CrossEdge {
  id?: number;
  consumerProjectId: string;
  consumerFile: string;
  consumerSymbol: string;
  consumerLine?: number;
  contractId: number;
  edgeType: string;
  confidence: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'both',
  last_indexed_at INTEGER,
  git_sha TEXT
);

CREATE TABLE IF NOT EXISTS interface_contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id),
  interface_type TEXT NOT NULL,
  source_file TEXT NOT NULL,
  symbol_name TEXT NOT NULL,
  symbol_kind TEXT NOT NULL,
  signature TEXT,
  file_line INTEGER,
  content_hash TEXT NOT NULL,
  UNIQUE(project_id, interface_type, symbol_name, symbol_kind)
);

CREATE INDEX IF NOT EXISTS idx_contracts_symbol ON interface_contracts(symbol_name);
CREATE INDEX IF NOT EXISTS idx_contracts_project ON interface_contracts(project_id);

CREATE TABLE IF NOT EXISTS cross_edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  consumer_project_id TEXT NOT NULL REFERENCES projects(id),
  consumer_file TEXT NOT NULL,
  consumer_symbol TEXT NOT NULL,
  consumer_line INTEGER,
  contract_id INTEGER NOT NULL REFERENCES interface_contracts(id),
  edge_type TEXT NOT NULL,
  confidence REAL DEFAULT 1.0,
  UNIQUE(consumer_project_id, consumer_symbol, contract_id)
);

CREATE INDEX IF NOT EXISTS idx_cross_edges_contract ON cross_edges(contract_id);
CREATE INDEX IF NOT EXISTS idx_cross_edges_consumer ON cross_edges(consumer_project_id);
`;

export class CrossRepoDb {
  private db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("synchronous = NORMAL");

    this.db.exec(SCHEMA);
  }

  // --- Projects ---

  upsertProject(id: string, path: string, name: string, role: string, gitSha: string): void {
    this.db
      .prepare(
        `INSERT INTO projects (id, path, name, role, last_indexed_at, git_sha)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           path = excluded.path,
           name = excluded.name,
           role = excluded.role,
           last_indexed_at = excluded.last_indexed_at,
           git_sha = excluded.git_sha`,
      )
      .run(id, path, name, role, Date.now(), gitSha);
  }

  getProject(id: string): CrossProject | null {
    const row = this.db
      .prepare("SELECT id, path, name, role, last_indexed_at, git_sha FROM projects WHERE id = ?")
      .get(id) as { id: string; path: string; name: string; role: string; last_indexed_at: number; git_sha: string } | undefined;
    return row ? this.mapProject(row) : null;
  }

  listProjects(): CrossProject[] {
    const rows = this.db
      .prepare("SELECT id, path, name, role, last_indexed_at, git_sha FROM projects")
      .all() as Array<{ id: string; path: string; name: string; role: string; last_indexed_at: number; git_sha: string }>;
    return rows.map((r) => this.mapProject(r));
  }

  // --- Interface contracts ---

  upsertContract(contract: InterfaceContract): void {
    this.db
      .prepare(
        `INSERT INTO interface_contracts (project_id, interface_type, source_file, symbol_name, symbol_kind, signature, file_line, content_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, interface_type, symbol_name, symbol_kind) DO UPDATE SET
           source_file = excluded.source_file,
           signature = excluded.signature,
           file_line = excluded.file_line,
           content_hash = excluded.content_hash`,
      )
      .run(
        contract.projectId,
        contract.interfaceType,
        contract.sourceFile,
        contract.symbolName,
        contract.symbolKind,
        contract.signature ?? null,
        contract.fileLine ?? null,
        contract.contentHash,
      );
  }

  getContractsForProject(projectId: string): InterfaceContract[] {
    const rows = this.db
      .prepare(
        "SELECT id, project_id, interface_type, source_file, symbol_name, symbol_kind, signature, file_line, content_hash FROM interface_contracts WHERE project_id = ?",
      )
      .all(projectId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapContract(r));
  }

  getContractBySymbol(symbolName: string, interfaceType?: string): InterfaceContract[] {
    if (interfaceType) {
      const rows = this.db
        .prepare(
          "SELECT id, project_id, interface_type, source_file, symbol_name, symbol_kind, signature, file_line, content_hash FROM interface_contracts WHERE symbol_name = ? AND interface_type = ?",
        )
        .all(symbolName, interfaceType) as Array<Record<string, unknown>>;
      return rows.map((r) => this.mapContract(r));
    }
    const rows = this.db
      .prepare(
        "SELECT id, project_id, interface_type, source_file, symbol_name, symbol_kind, signature, file_line, content_hash FROM interface_contracts WHERE symbol_name = ?",
      )
      .all(symbolName) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapContract(r));
  }

  deleteContractsForProject(projectId: string): void {
    // Delete edges that reference these contracts first (FK constraint)
    this.db
      .prepare(
        "DELETE FROM cross_edges WHERE contract_id IN (SELECT id FROM interface_contracts WHERE project_id = ?)",
      )
      .run(projectId);
    this.db.prepare("DELETE FROM interface_contracts WHERE project_id = ?").run(projectId);
  }

  // --- Cross-repo edges ---

  upsertCrossEdge(edge: CrossEdge): void {
    this.db
      .prepare(
        `INSERT INTO cross_edges (consumer_project_id, consumer_file, consumer_symbol, consumer_line, contract_id, edge_type, confidence)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(consumer_project_id, consumer_symbol, contract_id) DO UPDATE SET
           consumer_file = excluded.consumer_file,
           consumer_line = excluded.consumer_line,
           edge_type = excluded.edge_type,
           confidence = excluded.confidence`,
      )
      .run(
        edge.consumerProjectId,
        edge.consumerFile,
        edge.consumerSymbol,
        edge.consumerLine ?? null,
        edge.contractId,
        edge.edgeType,
        edge.confidence,
      );
  }

  getCrossEdgesForContract(contractId: number): CrossEdge[] {
    const rows = this.db
      .prepare(
        "SELECT id, consumer_project_id, consumer_file, consumer_symbol, consumer_line, contract_id, edge_type, confidence FROM cross_edges WHERE contract_id = ?",
      )
      .all(contractId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapEdge(r));
  }

  getCrossEdgesForProject(projectId: string): CrossEdge[] {
    const rows = this.db
      .prepare(
        "SELECT id, consumer_project_id, consumer_file, consumer_symbol, consumer_line, contract_id, edge_type, confidence FROM cross_edges WHERE consumer_project_id = ?",
      )
      .all(projectId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapEdge(r));
  }

  deleteCrossEdgesForProject(projectId: string): void {
    this.db.prepare("DELETE FROM cross_edges WHERE consumer_project_id = ?").run(projectId);
  }

  // --- Staleness ---

  isProjectStale(projectId: string, currentSha: string): boolean {
    const project = this.getProject(projectId);
    if (!project) return true;
    return project.gitSha !== currentSha;
  }

  // --- Lifecycle ---

  close(): void {
    this.db.close();
  }

  // --- Private mappers ---

  private mapProject(row: {
    id: string;
    path: string;
    name: string;
    role: string;
    last_indexed_at: number;
    git_sha: string;
  }): CrossProject {
    return {
      id: row.id,
      path: row.path,
      name: row.name,
      role: row.role,
      lastIndexedAt: row.last_indexed_at,
      gitSha: row.git_sha,
    };
  }

  private mapContract(row: Record<string, unknown>): InterfaceContract {
    return {
      id: row.id as number,
      projectId: row.project_id as string,
      interfaceType: row.interface_type as string,
      sourceFile: row.source_file as string,
      symbolName: row.symbol_name as string,
      symbolKind: row.symbol_kind as string,
      signature: (row.signature as string) ?? undefined,
      fileLine: (row.file_line as number) ?? undefined,
      contentHash: row.content_hash as string,
    };
  }

  private mapEdge(row: Record<string, unknown>): CrossEdge {
    return {
      id: row.id as number,
      consumerProjectId: row.consumer_project_id as string,
      consumerFile: row.consumer_file as string,
      consumerSymbol: row.consumer_symbol as string,
      consumerLine: (row.consumer_line as number) ?? undefined,
      contractId: row.contract_id as number,
      edgeType: row.edge_type as string,
      confidence: row.confidence as number,
    };
  }
}

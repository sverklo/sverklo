import type Database from "better-sqlite3";
import { createHash, randomBytes } from "node:crypto";
import type { Evidence, RetrievalMethod, VerifyResult } from "../types/index.js";

// Ceiling: 10 000 rows with 24-hour TTL. At retrieval-heavy usage
// (~2-3 tools per question) this is ~48 h of real use.
const MAX_ROWS = 10_000;
const TTL_MS = 24 * 60 * 60 * 1000;

export interface EvidenceInput {
  file: string;
  start_line: number;
  end_line: number;
  commit_sha: string | null;
  chunk_id: number | null;
  symbol: string | null;
  method: RetrievalMethod;
  score: number;
  content_hash: string; // sha256 of the span content
}

export interface StoredEvidence extends EvidenceInput {
  id: string;
  created_at: number;
}

export class EvidenceStore {
  private insertStmt: Database.Statement;
  private getByIdStmt: Database.Statement;
  private countStmt: Database.Statement;
  private deleteOldStmt: Database.Statement;
  private deleteOverflowStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.insertStmt = db.prepare(`
      INSERT INTO evidence
        (id, file_path, start_line, end_line, commit_sha, chunk_id,
         symbol_name, retrieval_method, score, content_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.getByIdStmt = db.prepare(`
      SELECT
        id, file_path as file, start_line, end_line, commit_sha,
        chunk_id, symbol_name as symbol, retrieval_method as method,
        score, content_hash, created_at
      FROM evidence WHERE id = ?
    `);
    this.countStmt = db.prepare("SELECT COUNT(*) as c FROM evidence");
    this.deleteOldStmt = db.prepare("DELETE FROM evidence WHERE created_at < ?");
    this.deleteOverflowStmt = db.prepare(`
      DELETE FROM evidence WHERE id IN (
        SELECT id FROM evidence ORDER BY created_at ASC LIMIT ?
      )
    `);
  }

  purge(now = Date.now()): number {
    const deleted = this.deleteOldStmt.run(now - TTL_MS).changes;
    const count = (this.countStmt.get() as { c: number }).c;
    if (count > MAX_ROWS) {
      this.deleteOverflowStmt.run(count - MAX_ROWS);
    }
    return deleted;
  }

  // Insert counter — used to amortize the overflow purge across many
  // inserts. A long-running MCP server would otherwise let the table
  // grow unbounded between Indexer constructions, since purge() was
  // only called once at startup.
  private insertsSincePurge = 0;
  private static readonly PURGE_INTERVAL = 256;

  insert(input: EvidenceInput): string {
    const id = `ev_${randomBytes(6).toString("hex")}`;
    this.insertStmt.run(
      id,
      input.file,
      input.start_line,
      input.end_line,
      input.commit_sha,
      input.chunk_id,
      input.symbol,
      input.method,
      input.score,
      input.content_hash,
      Date.now()
    );
    this.insertsSincePurge++;
    if (this.insertsSincePurge >= EvidenceStore.PURGE_INTERVAL) {
      this.insertsSincePurge = 0;
      try { this.purge(); } catch { /* keep insert path resilient */ }
    }
    return id;
  }

  getById(id: string): StoredEvidence | null {
    const row = this.getByIdStmt.get(id) as
      | (Omit<StoredEvidence, "file"> & { file: string })
      | undefined;
    return row ?? null;
  }

  count(): number {
    return (this.countStmt.get() as { c: number }).c;
  }

  /**
   * Convert a stored row back to the public `Evidence` shape used in the
   * tool-response envelope. `chunk_id` / `symbol` are null→undefined'd.
   */
  toEvidence(row: StoredEvidence): Evidence {
    return {
      id: row.id,
      file: row.file,
      lines: [row.start_line, row.end_line],
      sha: row.commit_sha,
      chunk_id: row.chunk_id ?? undefined,
      symbol: row.symbol ?? undefined,
      method: row.method,
      score: row.score,
    };
  }
}

export function hashSpan(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Compute a cheap Jaccard-on-tokens similarity between two code spans.
 * Tokens are identifier-ish: `[A-Za-z0-9_]+`. Whitespace + punctuation
 * collapse to token boundaries. 1.0 = identical token bag, 0.0 = disjoint.
 */
export function spanSimilarity(a: string, b: string): number {
  const tokA = new Set(tokens(a));
  const tokB = new Set(tokens(b));
  if (tokA.size === 0 && tokB.size === 0) return 1;
  let shared = 0;
  for (const t of tokA) if (tokB.has(t)) shared++;
  const union = tokA.size + tokB.size - shared;
  return union === 0 ? 0 : shared / union;
}

function tokens(s: string): string[] {
  return s.match(/[A-Za-z0-9_]+/g) ?? [];
}

/**
 * Classify the result of comparing the original evidence span to what's in
 * the file now.
 */
export function classifyVerify(opts: {
  fileExists: boolean;
  originalHash: string;
  currentHash: string | null;
  similarity: number | null;
  linesMoved: boolean;
}): VerifyResult["status"] {
  if (!opts.fileExists) return "file_missing";
  if (opts.currentHash !== null && opts.currentHash === opts.originalHash) {
    return "unchanged";
  }
  if (opts.linesMoved && (opts.similarity ?? 0) >= 0.75) return "moved";
  if ((opts.similarity ?? 0) >= 0.75) return "modified";
  return "deleted";
}

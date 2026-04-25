import type Database from "better-sqlite3";
import { randomBytes } from "node:crypto";

// Persistent context handles (v0.15, P1-8). Search-family tools register
// their full rendered output here and return a ctx://<tool>/<id> URI plus
// a short preview. Slicing / greping / stat queries then run against the
// stored body without rerunning retrieval.
//
// Handles are git-SHA-pinned: when the working-tree SHA differs from the
// handle's pinned SHA, the handle is treated as expired so callers can
// detect drift. TTL is the secondary backstop (24h).

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const PREVIEW_TOKEN_LIMIT = 200;
const PREVIEW_CHAR_LIMIT = PREVIEW_TOKEN_LIMIT * 4; // ~4 chars/token

export interface HandleRecord {
  id: string;
  tool: string;
  sha: string | null;
  created_at: number;
  expires_at: number;
  body: string;
  preview: string;
}

export class HandleStore {
  private upsertStmt: Database.Statement;
  private getStmt: Database.Statement;
  private deleteExpiredStmt: Database.Statement;
  private countStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.upsertStmt = db.prepare(`
      INSERT INTO context_handles
        (id, tool, sha, created_at, expires_at, body, preview)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    this.getStmt = db.prepare(`
      SELECT id, tool, sha, created_at, expires_at, body, preview
      FROM context_handles WHERE id = ?
    `);
    this.deleteExpiredStmt = db.prepare(
      "DELETE FROM context_handles WHERE expires_at < ?"
    );
    this.countStmt = db.prepare("SELECT COUNT(*) as c FROM context_handles");
  }

  create(tool: string, body: string, sha: string | null = null, ttlMs = DEFAULT_TTL_MS): HandleRecord {
    const id = `ctx_${randomBytes(8).toString("hex")}`;
    const now = Date.now();
    const preview = body.length > PREVIEW_CHAR_LIMIT
      ? body.slice(0, PREVIEW_CHAR_LIMIT) + "\n…"
      : body;
    this.upsertStmt.run(id, tool, sha, now, now + ttlMs, body, preview);
    return { id, tool, sha, created_at: now, expires_at: now + ttlMs, body, preview };
  }

  get(id: string): HandleRecord | null {
    return (this.getStmt.get(id) as HandleRecord | undefined) ?? null;
  }

  /**
   * Lookup + freshness check. Returns null if the handle is missing,
   * expired, or its pinned SHA no longer matches the current SHA.
   */
  getFresh(id: string, currentSha: string | null): HandleRecord | null {
    const r = this.get(id);
    if (!r) return null;
    if (r.expires_at < Date.now()) return null;
    if (currentSha && r.sha && currentSha !== r.sha) return null;
    return r;
  }

  purgeExpired(now = Date.now()): number {
    return this.deleteExpiredStmt.run(now).changes;
  }

  count(): number {
    return (this.countStmt.get() as { c: number }).c;
  }
}

export function buildHandleUri(toolName: string, handleId: string): string {
  // Strip the sverklo_ prefix for cleaner URIs.
  const tool = toolName.startsWith("sverklo_") ? toolName.slice("sverklo_".length) : toolName;
  return `ctx://${tool}/${handleId}`;
}

export function parseHandleUri(uri: string): { tool: string; id: string } | null {
  const m = /^ctx:\/\/([\w-]+)\/(ctx_[a-f0-9]+)$/.exec(uri.trim());
  if (!m) return null;
  return { tool: m[1], id: m[2] };
}

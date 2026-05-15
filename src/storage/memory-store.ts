import type { Database, Statement } from "./database.js";
import { transaction } from "./database.js";
import type { Memory, MemoryCategory, MemoryTier, MemoryKind } from "../types/index.js";

// Parse the pins JSON column into a Set for O(1) overlap checks.
// Returns an empty Set on null/undefined/malformed input.
function parsePinsSet(pins: string | null | undefined): Set<string> {
  if (!pins) return new Set();
  try {
    const parsed = JSON.parse(pins);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((p): p is string => typeof p === "string"));
  } catch {
    return new Set();
  }
}

// Default mapping from category → kind. Sprint 9: episodic/semantic/procedural
// is orthogonal to category — we just need a sensible default for old call
// sites that don't pass `kind` explicitly.
function defaultKindFor(category: MemoryCategory): MemoryKind {
  switch (category) {
    case "procedural":
      return "procedural";
    case "preference":
    case "pattern":
    case "correction":
      // Corrections are timeless rules (e.g. "never use em-dashes") that
      // shouldn't decay with time, so they live in the semantic axis
      // alongside preferences and patterns.
      return "semantic";
    default:
      return "episodic";
  }
}

export class MemoryStore {
  private insertStmt: Statement;
  private getByIdStmt: Statement;
  private getAllStmt: Statement;
  private getByCategoryStmt: Statement;
  private deleteStmt: Statement;
  private updateStmt: Statement;
  private searchFtsStmt: Statement;
  private touchAccessStmt: Statement;
  private markStaleStmt: Statement;
  private getStaleStmt: Statement;
  private invalidateStmt: Statement;
  private getCoreStmt: Statement;
  private setTierStmt: Statement;
  private getActiveStmt: Statement;
  private setPinsStmt: Statement;
  private setTrajectoryStmt: Statement;

  constructor(private db: Database) {
    this.insertStmt = db.prepare(`
      INSERT INTO memories (category, content, tags, confidence, git_sha, git_branch, related_files, created_at, updated_at, last_accessed, tier, valid_from_sha, kind)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.getByIdStmt = db.prepare("SELECT * FROM memories WHERE id = ?");
    // Active = not invalidated (valid_until_sha IS NULL)
    this.getAllStmt = db.prepare("SELECT * FROM memories WHERE valid_until_sha IS NULL ORDER BY created_at DESC LIMIT ?");
    this.getByCategoryStmt = db.prepare(
      "SELECT * FROM memories WHERE category = ? AND valid_until_sha IS NULL ORDER BY created_at DESC LIMIT ?"
    );
    this.deleteStmt = db.prepare("DELETE FROM memories WHERE id = ?");
    this.updateStmt = db.prepare(
      "UPDATE memories SET content = ?, tags = ?, updated_at = ? WHERE id = ?"
    );
    this.searchFtsStmt = db.prepare(`
      SELECT m.*, rank
      FROM memories_fts fts
      JOIN memories m ON m.id = fts.rowid
      WHERE memories_fts MATCH ? AND m.valid_until_sha IS NULL
      ORDER BY rank
      LIMIT ?
    `);
    this.touchAccessStmt = db.prepare(
      "UPDATE memories SET last_accessed = ?, access_count = access_count + 1 WHERE id = ?"
    );
    this.markStaleStmt = db.prepare(
      "UPDATE memories SET is_stale = ? WHERE id = ?"
    );
    this.getStaleStmt = db.prepare(
      "SELECT * FROM memories WHERE is_stale = 1 AND valid_until_sha IS NULL ORDER BY created_at DESC"
    );
    // Bi-temporal: invalidate a memory (mark superseded) instead of deleting
    this.invalidateStmt = db.prepare(`
      UPDATE memories
      SET valid_until_sha = ?, invalidated_at = ?, superseded_by = ?
      WHERE id = ?
    `);
    // Core memories for auto-injection
    this.getCoreStmt = db.prepare(`
      SELECT * FROM memories
      WHERE tier = 'core' AND valid_until_sha IS NULL
      ORDER BY confidence DESC, access_count DESC
      LIMIT ?
    `);
    this.setTierStmt = db.prepare("UPDATE memories SET tier = ? WHERE id = ?");
    this.getActiveStmt = db.prepare(
      "SELECT * FROM memories WHERE valid_until_sha IS NULL ORDER BY created_at DESC LIMIT ?"
    );
    this.setPinsStmt = db.prepare("UPDATE memories SET pins = ? WHERE id = ?");
    this.setTrajectoryStmt = db.prepare(
      "UPDATE memories SET trajectory = ? WHERE id = ?"
    );
  }

  /** P2-18: attach a JSON-serialised trajectory to a memory row. */
  setTrajectory(id: number, trajectoryJson: string): void {
    this.setTrajectoryStmt.run(trajectoryJson, id);
  }

  getTrajectory(id: number): string | null {
    const row = this.db
      .prepare("SELECT trajectory FROM memories WHERE id = ?")
      .get(id) as { trajectory: string | null } | undefined;
    return row?.trajectory ?? null;
  }

  insert(
    category: MemoryCategory,
    content: string,
    tags: string[] | null,
    confidence: number,
    gitSha: string | null,
    gitBranch: string | null,
    relatedFiles: string[] | null,
    tier: MemoryTier = "archive",
    kind?: MemoryKind
  ): number {
    const now = Date.now();
    const resolvedKind = kind ?? defaultKindFor(category);
    const result = this.insertStmt.run(
      category,
      content,
      tags ? JSON.stringify(tags) : null,
      confidence,
      gitSha,
      gitBranch,
      relatedFiles ? JSON.stringify(relatedFiles) : null,
      now,
      now,
      now,
      tier,
      gitSha,
      resolvedKind
    );
    return Number(result.lastInsertRowid);
  }

  /** Filter active memories by kind. */
  getByKind(kind: MemoryKind, limit: number = 50): Memory[] {
    return this.db
      .prepare(
        "SELECT * FROM memories WHERE kind = ? AND valid_until_sha IS NULL ORDER BY created_at DESC LIMIT ?"
      )
      .all(kind, limit) as unknown as Memory[];
  }

  /** Update a memory's kind in place. */
  setKind(id: number, kind: MemoryKind): void {
    this.db.prepare("UPDATE memories SET kind = ? WHERE id = ?").run(kind, id);
  }

  /**
   * Run multiple memory writes atomically against the underlying SQLite
   * connection. Callers pass a sync function — async work has to happen
   * outside the transaction. Used by `sverklo prune` so consolidation
   * can't half-commit a new memory without invalidating its originals.
   */
  transact<T>(fn: () => T): T {
    return transaction(this.db, fn);
  }

  getById(id: number): Memory | undefined {
    return this.getByIdStmt.get(id) as unknown as Memory | undefined;
  }

  getAll(limit: number = 50): Memory[] {
    return this.getAllStmt.all(limit) as unknown as Memory[];
  }

  getByCategory(category: MemoryCategory, limit: number = 50): Memory[] {
    return this.getByCategoryStmt.all(category, limit) as unknown as Memory[];
  }

  /**
   * Find pairs of active memories that may contradict each other.
   *
   * v0.20 introduces conflict detection on the bi-temporal memory layer.
   * Two memories are flagged as a conflict-candidate when they:
   *   1. are both active (`valid_until_sha IS NULL`)
   *   2. share at least one pin (file path or symbol name)
   *   3. have category "decision", "preference", or "pattern" — the
   *      categories where contradiction is meaningful (procedural and
   *      context memories are usually additive, not contradicting)
   *   4. were authored at different times (different `valid_from_sha`)
   *
   * The detection is intentionally conservative: it surfaces *candidates*,
   * not confirmed contradictions. The agent or human reviewer decides
   * whether the pair actually contradicts (e.g., "JWT in middleware" vs
   * "JWT in route handler" pinned to the same file IS a contradiction;
   * "validate input" vs "log all errors" pinned to the same file IS NOT).
   *
   * Returns pairs sorted by:
   *   1. number of shared pins (more shared = stronger signal)
   *   2. recency of the older memory (older = more likely to be stale)
   *
   * The semantic-similarity component (cosine over content embeddings)
   * is intentionally NOT in this first version — it requires loading
   * embeddings during the query, and the pin-overlap signal is already
   * load-bearing enough on real corpora. Adding embedding-similarity
   * is a v0.21 extension if pin-overlap proves too noisy in practice.
   */
  findConflicts(limit: number = 25): Array<{ a: Memory; b: Memory; sharedPins: string[] }> {
    const candidates = this.db
      .prepare(
        `
        SELECT * FROM memories
        WHERE valid_until_sha IS NULL
          AND pins IS NOT NULL
          AND pins != '[]'
          AND category IN ('decision', 'preference', 'pattern')
        ORDER BY created_at DESC
        `
      )
      .all() as unknown as Memory[];

    const pairs: Array<{ a: Memory; b: Memory; sharedPins: string[] }> = [];
    for (let i = 0; i < candidates.length; i++) {
      const a = candidates[i];
      const aPins = parsePinsSet(a.pins);
      if (aPins.size === 0) continue;
      for (let j = i + 1; j < candidates.length; j++) {
        const b = candidates[j];
        // Skip pairs from the same SHA — those are co-recorded by the same
        // remember call, not divergent beliefs.
        if (a.valid_from_sha && a.valid_from_sha === b.valid_from_sha) continue;
        const bPins = parsePinsSet(b.pins);
        const shared: string[] = [];
        for (const pin of aPins) {
          if (bPins.has(pin)) shared.push(pin);
        }
        if (shared.length === 0) continue;
        pairs.push({ a, b, sharedPins: shared });
      }
    }

    pairs.sort((x, y) => {
      const dShared = y.sharedPins.length - x.sharedPins.length;
      if (dShared !== 0) return dShared;
      const olderX = Math.min(x.a.created_at, x.b.created_at);
      const olderY = Math.min(y.a.created_at, y.b.created_at);
      return olderX - olderY;
    });

    return pairs.slice(0, limit);
  }

  delete(id: number): boolean {
    const result = this.deleteStmt.run(id);
    return result.changes > 0;
  }

  /**
   * Bi-temporal invalidation — marks a memory as superseded rather than deleting it.
   * Preserves history so users can query "what we believed at commit X".
   */
  invalidate(id: number, currentSha: string | null, supersededBy: number | null = null): void {
    this.invalidateStmt.run(currentSha, Date.now(), supersededBy, id);
  }

  getCore(limit: number = 10): Memory[] {
    return this.getCoreStmt.all(limit) as unknown as Memory[];
  }

  setTier(id: number, tier: MemoryTier): void {
    this.setTierStmt.run(tier, id);
  }

  update(id: number, content: string, tags?: string[]): void {
    this.updateStmt.run(
      content,
      tags ? JSON.stringify(tags) : null,
      Date.now(),
      id
    );
  }

  searchFts(query: string, limit: number = 20): (Memory & { rank: number })[] {
    try {
      const safeQuery = query
        .replace(/["'(){}[\]*:^~!@#$%&]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 1)
        .map((w) => `"${w}"`)
        .join(" OR ");
      if (!safeQuery) return [];
      return this.searchFtsStmt.all(safeQuery, limit) as unknown as (Memory & { rank: number })[];
    } catch {
      return [];
    }
  }

  touchAccess(id: number): void {
    this.touchAccessStmt.run(Date.now(), id);
  }

  markStale(id: number, stale: boolean): void {
    this.markStaleStmt.run(stale ? 1 : 0, id);
  }

  getStale(): Memory[] {
    return this.getStaleStmt.all() as unknown as Memory[];
  }

  setPins(id: number, pins: string[]): void {
    this.setPinsStmt.run(pins.length > 0 ? JSON.stringify(pins) : null, id);
  }

  /**
   * Find active memories pinned to a given target (file path or symbol name).
   * Scans the `pins` JSON array column with a LIKE match.
   */
  getByPin(target: string, limit: number = 20): Memory[] {
    // Use LIKE to find the target inside the JSON array string.
    // This is simple and correct for reasonable pin counts.
    return this.db
      .prepare(
        `SELECT * FROM memories
         WHERE pins LIKE ? AND valid_until_sha IS NULL
         ORDER BY confidence DESC, created_at DESC
         LIMIT ?`
      )
      .all(`%"${target.replace(/[%_"]/g, "")}"%`, limit) as unknown as Memory[];
  }

  count(): number {
    return (
      this.db.prepare("SELECT COUNT(*) as c FROM memories WHERE valid_until_sha IS NULL").get() as { c: number }
    ).c;
  }

  /**
   * Returns all memories including invalidated ones, for bi-temporal timeline views.
   */
  getTimeline(limit: number = 500): Memory[] {
    return this.db
      .prepare("SELECT * FROM memories ORDER BY created_at DESC LIMIT ?")
      .all(limit) as unknown as Memory[];
  }
}

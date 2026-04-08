// Append-only JSONL journal for memory writes (issue #7).
//
// Sverklo's memory layer lives in SQLite for query speed, but users
// can't easily inspect, diff, or sync a binary database. The Memory
// MCP reference server showed that append-only JSONL is the right
// format for user-facing memory: human-readable, git-diffable,
// trivially syncable, and impossible to corrupt in interesting ways.
//
// This module ships the JSONL format as a *mirror* of SQLite, not a
// replacement. Every memory write (remember / forget / promote /
// demote / invalidate) lands in both places. If the two ever
// disagree, SQLite is still the source of truth for 0.2.x — the
// migration to "JSONL as source of truth" is a later, more invasive
// step tracked in the same issue.
//
// Why mirror, not replace, in this step:
//   - Zero risk to existing users. If the journal is broken, memory
//     still works from SQLite.
//   - Users get the user-visible benefit today (cat / git diff /
//     grep the journal) without waiting for the full migration.
//   - The journal can be replayed into a fresh SQLite if the index
//     is ever deleted — a cheap disaster-recovery path.
//
// Format: one JSON object per line, one operation per object. Writes
// are append-only. Tombstones (forget) are records, not file rewrites.
// Compaction is a later feature — for now we just grow.
//
// File location: `<project>/.sverklo/memories.jsonl`. This lives
// inside the project root on purpose so users can commit it alongside
// their code. `.sverklo/index.db` and friends stay in `~/.sverklo/`
// (the user cache) because those are machine-specific.

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { logError } from "../utils/logger.js";

export type JournalOp =
  | "remember"
  | "forget"
  | "invalidate"
  | "promote"
  | "demote"
  | "touch";

export interface JournalEntry {
  op: JournalOp;
  id: number;
  ts: string; // ISO-8601 UTC timestamp
  // Present on 'remember' — everything needed to reconstruct the row.
  content?: string;
  category?: string;
  tags?: string[] | null;
  confidence?: number;
  git_sha?: string | null;
  git_branch?: string | null;
  related_files?: string[] | null;
  tier?: string;
  // Present on 'invalidate' — the SHA at which the memory was superseded
  // and the id of the memory that replaced it (if any).
  invalidated_at_sha?: string | null;
  replaced_by_id?: number | null;
  // Present on 'promote' / 'demote' — the destination tier.
  new_tier?: string;
  // Present on 'forget' — nothing extra, the id is enough.
}

/**
 * MemoryJournal writes append-only JSONL to <project>/.sverklo/memories.jsonl.
 *
 * Writes are synchronous on purpose: the journal must be committed
 * before the corresponding SQLite write returns to the caller, so we
 * never have a window where SQLite succeeds and the journal is missing
 * the record. Agent workloads are low-frequency on the memory side
 * (dozens of writes per session, not thousands) so sync writes are
 * fine. If memory write volume grows we can batch.
 *
 * Errors are swallowed with a log. The journal is advisory for 0.2.x —
 * a broken journal must not break memory.
 */
export class MemoryJournal {
  private path: string;
  private ready = false;

  constructor(projectRoot: string) {
    this.path = join(projectRoot, ".sverklo", "memories.jsonl");
  }

  private ensureDir(): void {
    if (this.ready) return;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      this.ready = true;
    } catch (err) {
      logError("MemoryJournal: could not create .sverklo directory", err);
    }
  }

  private write(entry: JournalEntry): void {
    this.ensureDir();
    try {
      appendFileSync(this.path, JSON.stringify(entry) + "\n", "utf-8");
    } catch (err) {
      logError("MemoryJournal: append failed", err);
    }
  }

  remember(params: {
    id: number;
    content: string;
    category: string;
    tags?: string[] | null;
    confidence: number;
    git_sha?: string | null;
    git_branch?: string | null;
    related_files?: string[] | null;
    tier: string;
  }): void {
    this.write({
      op: "remember",
      id: params.id,
      ts: new Date().toISOString(),
      content: params.content,
      category: params.category,
      tags: params.tags ?? null,
      confidence: params.confidence,
      git_sha: params.git_sha ?? null,
      git_branch: params.git_branch ?? null,
      related_files: params.related_files ?? null,
      tier: params.tier,
    });
  }

  forget(id: number): void {
    this.write({
      op: "forget",
      id,
      ts: new Date().toISOString(),
    });
  }

  invalidate(id: number, atSha: string | null, replacedById: number | null): void {
    this.write({
      op: "invalidate",
      id,
      ts: new Date().toISOString(),
      invalidated_at_sha: atSha ?? null,
      replaced_by_id: replacedById ?? null,
    });
  }

  promote(id: number, newTier: string): void {
    this.write({
      op: "promote",
      id,
      ts: new Date().toISOString(),
      new_tier: newTier,
    });
  }

  demote(id: number, newTier: string): void {
    this.write({
      op: "demote",
      id,
      ts: new Date().toISOString(),
      new_tier: newTier,
    });
  }

  /**
   * Return the path to the journal file so callers can show it in
   * error messages ("see .sverklo/memories.jsonl for the write log").
   */
  get filePath(): string {
    return this.path;
  }

  /**
   * True if the journal file exists on disk. Useful for the doctor
   * command to report journal presence.
   */
  exists(): boolean {
    return existsSync(this.path);
  }
}

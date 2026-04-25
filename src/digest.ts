// Sprint 9 follow-up: `sverklo digest` — the morning-ritual habit loop
// from ROADMAP_V1.md. Five-line summary of what changed in the project
// since last week (or any window the user passes), suitable for a shell
// hook on `cd` or a Slack/email post.
//
// This is the v0.16.0 prototype: pure read of existing data the indexer
// already holds. The Slack/email/scheduled output paths are deferred to
// v0.18 along with the rest of the habit-loop work.

import type { Indexer } from "./indexer/indexer.js";
import { getAuditHistory, formatTrend } from "./utils/audit-history.js";

export interface DigestOptions {
  /** Window in days. Default 7. */
  sinceDays?: number;
  /** Output format. Markdown is default; "plain" drops markdown decoration. */
  format?: "markdown" | "plain";
}

export function generateDigest(indexer: Indexer, opts: DigestOptions = {}): string {
  const sinceDays = opts.sinceDays ?? 7;
  const format = opts.format ?? "markdown";
  const sinceMs = Date.now() - sinceDays * 86_400_000;

  const lines: string[] = [];
  const h2 = (s: string) => (format === "markdown" ? `## ${s}` : s.toUpperCase());
  const bullet = (s: string) => (format === "markdown" ? `- ${s}` : `• ${s}`);

  // Line 1: title with project name + window
  const projectName = indexer.rootPath.split("/").pop() || "project";
  lines.push(h2(`sverklo digest — ${projectName} (last ${sinceDays}d)`));
  lines.push("");

  // Line 2: audit grade trend
  const history = getAuditHistory(indexer.rootPath);
  const recent = history.slice(-5);
  const trend = formatTrend(recent.map((e) => e.grade));
  if (trend) {
    lines.push(bullet(`audit grade: ${trend}`));
  } else if (history.length === 1) {
    lines.push(bullet(`audit grade: ${history[0].grade} (single audit, no trend yet)`));
  } else {
    lines.push(bullet("audit grade: no history yet — run `sverklo audit` to seed"));
  }

  // Line 3: stale memories
  const memories = indexer.memoryStore.getAll(1000);
  const staleCount = memories.filter((m) => m.is_stale === 1).length;
  const recentMemories = memories.filter((m) => m.created_at >= sinceMs).length;
  lines.push(
    bullet(
      `memory: ${recentMemories} new, ${staleCount} stale (run \`sverklo prune --dry-run\` to review)`
    )
  );

  // Line 4: high-PR symbols touched (proxy: top-10 PR files modified in window)
  const files = indexer.fileStore.getAll().slice(0, 100);
  const recentlyTouched = files
    .filter((f) => f.last_modified >= sinceMs)
    .sort((a, b) => b.pagerank - a.pagerank)
    .slice(0, 5);
  if (recentlyTouched.length > 0) {
    const names = recentlyTouched
      .map((f) => `${f.path.split("/").pop()} (PR ${f.pagerank.toFixed(2)})`)
      .join(", ");
    lines.push(bullet(`high-importance files touched: ${names}`));
  } else {
    lines.push(bullet("high-importance files touched: none in window"));
  }

  // Line 5: total scope
  lines.push(
    bullet(
      `scope: ${files.length}+ files, ${memories.length} memories, ${indexer.chunkStore.count()} chunks indexed`
    )
  );
  lines.push("");

  return lines.join("\n");
}

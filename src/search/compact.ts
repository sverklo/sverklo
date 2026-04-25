import type { SearchResult } from "../types/index.js";

// Collapse near-duplicate chunks in the same file. Two chunks are "similar" when
// they share type AND a normalized prefix hash — we keep the highest-scored one
// and attach a _N similar collapsed_ note so the caller knows more exists.
export function dedupChunks(results: SearchResult[]): {
  kept: SearchResult[];
  collapsed: Map<number, number>; // kept.chunk.id -> count of similar chunks collapsed into it
} {
  const keepersByKey = new Map<string, SearchResult>();
  const collapsed = new Map<number, number>();

  for (const r of results) {
    const key = `${r.file.id}:${r.chunk.type}:${hashPrefix(r.chunk.content)}`;
    const prior = keepersByKey.get(key);
    if (!prior) {
      keepersByKey.set(key, r);
      continue;
    }
    // Keep the higher-scored one; count the loser as a collapsed similar.
    const winner = r.score > prior.score ? r : prior;
    const loser = winner === r ? prior : r;
    keepersByKey.set(key, winner);
    collapsed.set(winner.chunk.id, (collapsed.get(winner.chunk.id) ?? 0) + 1);
    // Also absorb any counts the loser had carried.
    const loserCount = collapsed.get(loser.chunk.id);
    if (loserCount) {
      collapsed.set(winner.chunk.id, (collapsed.get(winner.chunk.id) ?? 0) + loserCount);
      collapsed.delete(loser.chunk.id);
    }
  }

  // Preserve original score ordering
  const kept = Array.from(keepersByKey.values()).sort((a, b) => b.score - a.score);
  return { kept, collapsed };
}

function hashPrefix(content: string): string {
  // Normalize whitespace + drop comments for a stable-ish similarity hash.
  const normalized = content
    .slice(0, 200)
    .replace(/\s+/g, " ")
    .replace(/\/\/.*$/gm, "")
    .trim();
  return cheapHash(normalized);
}

function cheapHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

// Group 3+ results from the same directory prefix (2 levels deep) when their
// scores cluster within 15% of the group top. Returns the kept "hub" result per
// group (the highest-scored) plus a count of siblings collapsed.
export function groupByDirectory(results: SearchResult[]): {
  kept: SearchResult[];
  groupCounts: Map<number, { count: number; dir: string }>;
} {
  const byDir = new Map<string, SearchResult[]>();
  for (const r of results) {
    const dir = dirPrefix(r.file.path);
    const list = byDir.get(dir) ?? [];
    list.push(r);
    byDir.set(dir, list);
  }

  const kept: SearchResult[] = [];
  const groupCounts = new Map<number, { count: number; dir: string }>();

  for (const [dir, members] of byDir) {
    if (members.length < 3) {
      kept.push(...members);
      continue;
    }
    // Sort by score descending.
    members.sort((a, b) => b.score - a.score);
    const top = members[0];
    const cutoff = top.score * 0.85;
    const clustered = members.filter((m) => m.score >= cutoff);
    const outsiders = members.filter((m) => m.score < cutoff);

    if (clustered.length >= 3) {
      kept.push(top);
      groupCounts.set(top.chunk.id, { count: clustered.length - 1, dir });
      // Promote outsiders as individual results (they weren't part of the cluster).
      kept.push(...outsiders);
    } else {
      kept.push(...members);
    }
  }

  // Preserve original score ordering across all groups.
  kept.sort((a, b) => b.score - a.score);
  return { kept, groupCounts };
}

function dirPrefix(path: string): string {
  const parts = path.split("/").filter(Boolean);
  // Drop filename, keep first 2-3 path segments so we cluster at the subsystem
  // level (e.g. "src/auth" rather than "src/auth/middleware" when they're peers).
  if (parts.length <= 2) return parts.slice(0, -1).join("/") || ".";
  return parts.slice(0, Math.min(parts.length - 1, 2)).join("/");
}

// Middle-truncate a list of lines, keeping the head and a tiny tail so the
// closing brace / signature hint survives. Used by compact mode.
export function middleTruncate(
  lines: string[],
  keepHead = 4,
  keepTail = 1
): { head: string[]; elided: number; tail: string[] } | null {
  if (lines.length <= keepHead + keepTail + 1) return null;
  return {
    head: lines.slice(0, keepHead),
    elided: lines.length - keepHead - keepTail,
    tail: lines.slice(-keepTail),
  };
}

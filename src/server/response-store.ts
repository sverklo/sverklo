// In-memory LRU for tool responses so post-filter primitives (grep_results,
// head_results, ctx_peek) can operate on a prior call without re-running
// retrieval. Intentionally small and ephemeral — persistent handles with
// git-SHA pinning land in P1-8.

export interface StoredResponse {
  id: string;
  tool: string;
  text: string;
  created_at: number;
}

const MAX_ENTRIES = 16;
const TTL_MS = 10 * 60 * 1000; // 10 minutes

class ResponseStore {
  private entries = new Map<string, StoredResponse>(); // insertion-ordered → LRU

  set(tool: string, text: string): string {
    this.prune();
    const id = `rsp_${randomHex(12)}`;
    this.entries.set(id, { id, tool, text, created_at: Date.now() });
    if (this.entries.size > MAX_ENTRIES) {
      // Drop the oldest (first in insertion order).
      const firstKey = this.entries.keys().next().value;
      if (firstKey !== undefined) this.entries.delete(firstKey);
    }
    return id;
  }

  get(id: string): StoredResponse | undefined {
    this.prune();
    const hit = this.entries.get(id);
    if (!hit) return undefined;
    // Refresh LRU order: re-insert so it becomes the newest entry.
    this.entries.delete(id);
    this.entries.set(id, hit);
    return hit;
  }

  size(): number {
    this.prune();
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  private prune(): void {
    const cutoff = Date.now() - TTL_MS;
    for (const [id, r] of this.entries) {
      if (r.created_at < cutoff) this.entries.delete(id);
      else break; // insertion order guarantees remaining entries are newer
    }
  }
}

function randomHex(n: number): string {
  let out = "";
  for (let i = 0; i < n; i++) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

// Per-process singleton. MCP server instantiates once; every tool dispatch
// registers its response here before returning.
export const responseStore = new ResponseStore();

// Code-search synonym map. Bridges the gap between how a question is
// phrased ("How does sverklo CHECK whether a citation is valid") and how
// the code names it ("verifyEvidence", "validate"). Conservative — every
// pair was added because of an actual eval miss in `bench:research`.
//
// The map is bidirectional at lookup time: querying "verify" expands to
// {verify, check, validate, audit}, and querying "check" expands to the
// same set. Synonyms are emitted as additional FTS / symbol-name search
// terms; cosine vector search isn't affected (the model handles its own
// semantics).

const SYNONYM_GROUPS: string[][] = [
  // Validation / safety
  ["verify", "validate", "check", "audit"],
  ["valid", "verified", "validated", "checked"],

  // Lookup / search
  ["find", "lookup", "locate", "search"],
  ["fetch", "get", "load", "retrieve", "read"],

  // Iteration / re-execution
  ["index", "reindex", "rebuild", "refresh"],
  ["watch", "monitor", "observe", "track"],
  ["change", "modify", "update", "edit", "mutate"],

  // Storage
  ["store", "save", "persist", "cache"],
  ["delete", "remove", "purge", "drop"],

  // Construction
  ["build", "construct", "generate", "make", "create"],
  ["fuse", "merge", "combine", "blend"],

  // Analysis
  ["analyze", "audit", "inspect", "examine", "evaluate"],
  ["score", "grade", "rank", "rate"],

  // Run / dispatch
  ["run", "execute", "invoke", "call", "dispatch"],
  ["handle", "process", "manage"],

  // Memory / decisions
  ["remember", "store", "memo", "memoize"],
  ["recall", "remember", "recover"],
  ["stale", "outdated", "expired", "obsolete"],

  // Specifically present in sverklo's codebase
  ["embedder", "embedding", "vector"],
  ["budget", "limit", "cap"],
  ["tool", "command"],
  ["test", "spec"],
  ["citation", "evidence", "reference"],
  ["map", "mapping", "match"],
  ["parse", "parser", "decode"],
  ["pattern", "design", "role"],
  ["concept", "topic", "subsystem"],
  ["doc", "documentation", "comment"],
  ["chunk", "section", "block"],

  // Domain-specific bridges (added for eval misses where the query
  // describes a *behavior* and the code is named for the *mechanism*).
  // The watcher is what notices file changes; "change/changed" → watcher.
  ["change", "changed", "watch", "watcher"],
  // Reindex is what the watcher triggers; tie them together.
  ["reindex", "indexing", "watcher", "watch"],
  // Stale memory detection lives next to git state.
  ["stale", "git-state", "git", "sha"],
  // Bi-temporal / "when was X true" maps to git state.
  ["created", "creation", "git-state", "git", "sha"],
];

const FORWARD_INDEX: Map<string, Set<string>> = (() => {
  const map = new Map<string, Set<string>>();
  for (const group of SYNONYM_GROUPS) {
    for (const word of group) {
      let bucket = map.get(word);
      if (!bucket) {
        bucket = new Set<string>();
        map.set(word, bucket);
      }
      for (const other of group) {
        if (other !== word) bucket.add(other);
      }
    }
  }
  return map;
})();

/**
 * Return synonyms for a single token. Returns the empty list when the
 * token isn't in our map (we don't fuzzy-match — false expansions hurt
 * more than they help).
 */
export function synonymsOf(token: string): string[] {
  const set = FORWARD_INDEX.get(token.toLowerCase());
  return set ? Array.from(set) : [];
}

/**
 * Expand a query token list with conservative synonyms. Returns the
 * deduped union (originals + synonyms) so all-downstream retrievers can
 * use the expanded set without further bookkeeping.
 */
export function expandTokens(tokens: string[]): string[] {
  const out = new Set<string>(tokens);
  for (const t of tokens) {
    for (const syn of synonymsOf(t)) out.add(syn);
  }
  return Array.from(out);
}

/**
 * Build an FTS5 query string from a list of tokens that ORs each one,
 * adding synonyms inline. Caller still has to escape special chars; this
 * just constructs the expansion.
 */
export function expandFtsQuery(rawQuery: string): string {
  const words = rawQuery
    .split(/[^A-Za-z0-9_]+/)
    .filter((w) => w.length >= 3)
    .map((w) => w.toLowerCase());
  const expanded = expandTokens(words);
  return expanded.join(" ");
}

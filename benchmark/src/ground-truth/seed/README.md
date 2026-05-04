# Bench ground-truth seed files

## sverklo.jsonl

Static ground-truth tasks for the sverklo-on-itself dataset. Hand-authored.

### sv-p5 curation methodology (May 2026, issue #27)

The original sv-p5 expected sets each contained one symbol. Some were not
exported functions (e.g. `EMBEDDING_DIM` is a numeric constant,
`DiscoveredFile` is a TypeScript type alias) — most static dead-code
analyzers focus on functions and silently skip constants/types, so those
tasks unfairly penalized analyzers that did the right thing.

The current sv-p5 expected set contains **6 confirmed-dead exported
functions**, the same set across all 5 tasks (since each task asks the
same global "find dead code" question):

| Symbol | Defined in | Verification |
|---|---|---|
| `truncateToTokenBudget` | `src/utils/tokens.ts` | Exported function; only its def file references it (file-grep across `src/`, `benchmark/src/`, `bin/`) |
| `importGitLog` | `src/memory/import.ts` | Same |
| `classifyVerify` | `src/storage/evidence-store.ts` | Same |
| `defaultEdgeKindFor` | `src/storage/doc-edge-store.ts` | Same |
| `detectCycles` | `src/server/audit-analysis.ts` | Same |
| `diffCommandWorks` | `src/server/tools/review-format.ts` | Same |

**Verification command** used to confirm each is genuinely dead:

```bash
grep -rln --include='*.ts' \
  --exclude-dir=node_modules --exclude-dir=dist \
  "\b<SYMBOL>\b" src/ benchmark/src/ bin/
```

A result of exactly 1 file (the symbol's own def file) is the criterion
for "dead." This catches the strict case where no other static reference
exists. It does not catch dynamic dispatch (string-keyed lookups, MCP
tool registration via `tools_by_name[name]`, JSON-RPC method dispatch).
For sverklo's codebase, none of the 6 above are reached via dynamic
dispatch — manually verified by reading the surrounding modules.

**Excluded categories:**

- TypeScript types and interfaces (`DiscoveredFile`, `ChunkType`,
  `BundleOptions` etc.) — most dead-code analyzers don't track these.
- Numeric / string constants (`EMBEDDING_DIM`) — same reason.
- MCP tool handler exports (`auditTool`, `clustersTool`, `askTool`) —
  registered dynamically via the tool-registry pattern; static analyzers
  correctly flag them as having no static caller, but they are *live*
  in the running system. Including them as "expected dead" would
  reward false positives.

### Re-curation

To refresh the dead-code set when the codebase evolves:

```bash
# 1. Pull all exported names
grep -rEn --include='*.ts' \
  --exclude-dir=node_modules --exclude-dir=dist \
  --exclude-dir=test --exclude='*.test.ts' \
  'export (function|const|class|interface|type) ' src/ \
  | grep -oE 'export (function|const|class|interface|type) [A-Za-z_]+' \
  | awk '{print $3}' | sort -u

# 2. For each, count file references
for name in <list>; do
  count=$(grep -rln --include='*.ts' \
    --exclude-dir=node_modules --exclude-dir=dist \
    "\b$name\b" src/ benchmark/src/ bin/ | wc -l)
  echo "$count $name"
done | sort -n

# 3. Filter for: count == 1 AND kind == function AND not dynamic-dispatch.
```

## express.gen.ts

Runtime-resolving ground-truth generator for the express dataset. See
its inline docstring for methodology — uses pattern-matching grep to
resolve symbol names to (file, line) tuples at bench-startup, so
maintainers don't have to keep static line numbers in sync with
upstream express releases.

## lodash.gen.ts

Ground-truth generator for lodash 4.17.21 (issue #26). The single-file
IIFE structure of lodash 4.17.21 + the call-graph-only fallback path in
jcodemunch v1.80.9 make this a meaningfully different test case from
express's modular CommonJS structure.

**P1 (definition lookup):** 10 hand-verified line numbers for well-known
public methods (`map`, `filter`, `reduce`, `debounce`, `throttle`,
`merge`, `cloneDeep`, `get`, `set`, `chunk`) inside `lodash.js`. If
upstream shifts these in a future patch, re-verify with:

```bash
for sym in map filter reduce debounce throttle merge cloneDeep get set chunk; do
  line=$(grep -nE "^\s*function $sym\\b" lodash.js | head -1 | cut -d: -f1)
  echo "$sym: line $line"
done
```

**P2 (reference finding):** Same 10 names, references resolved at runtime
via grep. Each method is called many times within the IIFE, so the
expected set is large but stable.

**P4 (file dependencies):** 5 entries — 4 in `fp/` (which has real
inter-file imports) plus `lodash.js` itself (no imports, exercises the
"empty import graph" case).

**P5 (dead code):** Empty-expected pattern, same as `express`. Score
punishes false positives, which is what jcodemunch v1.80.9's
monolithic-IIFE fixes specifically reduce. Pre-fix versions flagged
published methods as dead due to the import-graph-only requirement.

### Re-running the bench on lodash

```bash
# All 5 baselines on all 3 datasets
npm run bench:quick

# Just lodash + jcodemunch
BASELINES=jcodemunch DATASETS=lodash npm run bench:quick
# (note: DATASETS env not yet implemented, run-primitive.ts loops over
# all datasets in the manifest)
```

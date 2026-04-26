# Parser parity baseline — v0.17

Tree-sitter is opt-in via `SVERKLO_PARSER=tree-sitter` plus
`sverklo grammars install`. Before we flip the default in v0.18 we want
a reproducible "before" so the flip is a measurable improvement, not a
gut feel. This doc captures the baseline + the script that produces it.

## How to run

```bash
npm run build
node scripts/parity-check.mjs --max 200 --lang typescript
node scripts/parity-check.mjs --json > parity.json
```

## Baseline — sverklo's own repo, TypeScript only (2026-04-26)

```
Files scanned: 175
  tree-sitter active: 175
  regex fallback:     0

Symbols (named chunks) discovered:
  regex parser:        748
  tree-sitter parser:  851
  intersection:        664
  only in regex:       84  (tree-sitter would miss these)
  only in tree-sitter: 187  (regex misses these)
  jaccard agreement:   71.0%
```

## What the diff is made of

**Tree-sitter wins (regex misses 187 symbols)** — predominantly class
methods (`embed`, `init`, `constructor`, `dimensions`, etc.) and
helpers inside larger functions. These are the cases that regex line-
matching can't catch without an actual AST.

**Regex "wins" (tree-sitter misses 84 symbols)** — mostly synthetic
chunks: the regex parser injects a `module:_module` chunk per file to
hold leading docstrings/comments (see parser.ts `extractFileHeader`).
Tree-sitter doesn't generate these because they aren't real AST nodes.
They are useful for retrieval — the file header often contains the
prose that explains the file — so the v0.18 work needs to preserve
this behaviour even after the parser flip. Approach: keep
`extractFileHeader` running regardless of parser; tree-sitter just
contributes the AST-derived chunks on top.

The remaining ~10% of "only in regex" are local/inner functions named
identically to module-level functions where the regex over-matches.
Net: tree-sitter is strictly better on real symbols.

## Verdict

Parity is not yet at the bar for a default flip — 71% Jaccard would
change ranking on too many existing benchmark queries. The two-step
plan to get to default-on:

1. **v0.17 (this release):** opt-in only. `SVERKLO_PARSER=tree-sitter`
   plus `sverklo grammars install` for users who want the better
   method extraction today.
2. **v0.18 work that has to happen before default flip:**
   - Keep `extractFileHeader` running on top of tree-sitter so the
     synthetic `_module` chunks don't disappear (closes the 84 gap).
   - Run `bench:research` against tree-sitter and confirm recall
     stays at 99%/31-of-32 or better.
   - Run `bench:swe` against tree-sitter and confirm cross-repo recall
     doesn't regress.
   - Flip the default when both benches are at parity.

## Reproducer

`scripts/parity-check.mjs` walks the repo, parses each file with both
paths, compares the named-chunk sets, and prints per-file divergences
plus the aggregate. Run it on any repo you care about — the question
"would my codebase win or lose if I flipped to tree-sitter today?" has
a numerical answer.

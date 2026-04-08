# Sverklo Benchmark

This directory contains two harnesses:

## v2 — Tier A primitives (current)

Quality-gated, hand-authored ground truth, no agentic loops. Measures the
*primitives* each baseline gives an LLM (definition lookup, references,
file deps, dead code) and reports F1 + tokens-per-correct-answer at a
fixed quality bar.

```bash
npm run build
npm run bench:quick
```

Outputs:

```
benchmark/results/<run-id>/
  raw.jsonl       # one line per (task, baseline)
  summary.json    # aggregated by category × baseline
  report.md       # human-readable
```

### Layout

```
benchmark/
  src/
    types.ts                  # Task, RunMetrics, Baseline interfaces
    estimator.ts              # token estimator (chars/3.5)
    runner/
      run-primitive.ts        # main loop: dataset × baseline × task
      score.ts                # recall / precision / F1 (with tolerances)
      report.ts               # markdown report writer
    baselines/
      base.ts                 # Baseline interface + BaselineOutput
      naive-grep.ts           # grep -rn + cat top 10 files (the floor)
      smart-grep.ts           # filtered grep + targeted ±10 line reads
      sverklo.ts              # spawns sverklo MCP, calls lookup/refs/deps/audit
    datasets/
      manifest.json           # repos with pinned refs
      fetch.ts                # shallow git clone for non-local datasets
    ground-truth/
      schema.ts               # JSONL loader
      seed/
        sverklo.jsonl         # hand-authored 30-task seed for sverklo itself
        express.gen.ts        # generator: resolves symbol locations from clone
  scripts/
    bench-quick.sh            # CI-friendly Tier A only
  results/                    # per-run output (gitignored except .gitkeep)
```

### Tasks

| Category | What | How baselines answer |
|---|---|---|
| P1 | Symbol definition lookup | predict (file, line) for one symbol |
| P2 | Reference finding | predict all (file, line) callsites |
| P4 | File dependencies | predict imports + reverse-imports |
| P5 | Dead code candidates | predict unused exported names |

Scoring tolerances: P1 ±3 lines, P2 ±2 lines (parsers disagree on
"def line" — signature vs body). P4/P5 use set membership on
extension-stripped paths / names.

### Quality gate

The headline `tokens_per_correct_answer` is computed only over runs with
**F1 >= 0.8**. Otherwise we'd reward "found nothing cheaply". The
ungated number is also reported for transparency.

### Datasets

| name | source | how |
|---|---|---|
| sverklo | local checkout | always |
| express | expressjs/express @ 4.21.1 | shallow clone on first run |

## v1 — `benchmark.ts` (legacy)

The old token-savings demo at `benchmark/benchmark.ts`. Kept for
comparison until v2 is validated. Run with `npm run benchmark -- <path>`.

It produces the misleading "5× fewer tokens" headline because it has no
quality gate — it compares "found something" to "found something else"
as if both were correct.

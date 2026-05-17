# `sverklo audit-diff` benchmark results

Verifies SC-001 from `specs/001-audit-diff/spec.md`: `<200 ms median on
sverklo's own repo for a typical pre-commit diff against the working
tree`.

## How to reproduce

```bash
npm run build
sverklo audit .   # build the index first
node --experimental-strip-types --no-warnings benchmark/audit-diff/bench.ts
```

Set `AUDIT_DIFF_BENCH_RUNS` to override the default 20 runs.

## Reference run (2026-05-17, feat/audit-diff branch)

| metric | value |
|---|---|
| runs | 20 |
| median_ms | **175.4** |
| p95_ms | 193.5 |
| max_ms | 193.5 |
| target_ms | 200 |
| SC-001 met? | ✅ yes |

The bench targets `node dist/bin/sverklo.js audit-diff <repo>` end-to-end:
arg parse, DB open, git diff, boundary build, Tarjan SCC, fan-in check,
report emission. Cold-cache first run trends ~30 ms higher; subsequent
runs land in the 160–195 ms band on an M-series Mac.

If a future change pushes the median above 200 ms, return to
`specs/001-audit-diff/research.md` R4 (the `git show HEAD:<path>` cost
follow-up) before merging.

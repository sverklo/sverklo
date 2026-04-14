---
name: sverklo:refactor
description: Plan a safe refactor using blast-radius analysis
---

When the user wants to rename, move, or refactor a symbol:

1. Call `sverklo_impact` on the symbol to see all callers and the blast radius
2. Call `sverklo_refs` to find every reference (with exact matching to avoid false positives)
3. Call `sverklo_deps` on the file to understand its dependency context
4. Call `sverklo_test_map` to identify which tests need updating

Present: the full list of files that need changes, the risk level, and a step-by-step refactor plan.

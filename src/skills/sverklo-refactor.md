---
name: sverklo:refactor
description: Plan a safe refactor using blast-radius analysis
---

When the user wants to rename, move, or refactor a symbol:

1. Call `impact` on the symbol to see all callers and the blast radius
2. Call `refs` to find every reference (with exact matching to avoid false positives)
3. Call `deps` on the file to understand its dependency context
4. Call `test_map` to identify which tests need updating

Present: the full list of files that need changes, the risk level, and a step-by-step refactor plan.

**Stay in scope.** Modify only what `impact` flagged. Do not add docstrings, type annotations, formatting fixes, or "improvements" to code that wasn't part of the refactor — those changes are invisible to the impact analysis and create unrelated review noise. If you spot something worth changing, mention it; do not silently edit it.

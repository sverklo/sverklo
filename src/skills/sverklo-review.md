---
name: sverklo:review
description: Review the current diff with risk scoring and impact analysis
---

When the user asks to review changes, a PR, or a diff:

1. Call `review_diff` to get risk-scored file analysis, dangling references, and structural warnings
2. For any high-risk files, call `impact` on the changed symbols to see the full blast radius
3. Call `test_map` to check which tests cover the changed code

Present: risk summary, files that need attention, untested changes, and suggested next steps.

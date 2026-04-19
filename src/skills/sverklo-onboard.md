---
name: sverklo:onboard
description: Get a complete understanding of this codebase using sverklo's code intelligence
---

When the user asks to understand, explore, or onboard to a codebase:

1. Call `sverklo_context` to get the project overview, saved memories, and codebase map
2. Call `sverklo_overview` to see the most important files ranked by PageRank
3. Call `sverklo_audit` to identify god nodes, hub files, and dead code

Present a summary: what the project does, its key modules, architectural patterns, and any code quality concerns.

**Tool-call budget.** Cap exploratory work at ~5 sverklo calls. If you don't have the answer after `sverklo_overview` + 2-3 targeted `sverklo_search`/`sverklo_lookup` calls, ask a clarifying question instead of issuing a 6th call. Avoid re-reading files you have already read unless they may have changed — when sverklo returns a path, treat it as known.

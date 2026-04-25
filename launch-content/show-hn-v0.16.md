# Show HN draft — v0.16.0

The fresh draft that uses the new hero ("Stop your AI from making things up about your codebase") and surfaces the v0.16 features (`sverklo prune`, `sverklo digest`, depth on overview, kind on memories, the channelized RRF + bi-temporal `superseded_by` story). Replaces the v0.2.16 draft in `hn-show-hn.md`.

## Title — pick ONE

**Primary** (matches the new hero, low-friction, doesn't trigger LLM-detection reflex):
> Show HN: Sverklo – Stop your AI from making things up about your codebase

**Alternate** (more technical, leads with the moat):
> Show HN: Sverklo – Local-first MCP with bi-temporal memory and channelized RRF (MIT)

**Alternate** (problem-first):
> Show HN: Sverklo – I got tired of Claude hallucinating imports, so I built a symbol graph

**Do NOT use:**
- Anything with "fastest" / "best" / "finally"
- "I made" prefix — every Show HN is "I made"
- Em dashes — some HN users reflexively dismiss LLM-written copy on sight

## URL

`https://github.com/sverklo/sverklo` — not the npm page (HN tradition).

## Body (under 1000 chars; HN penalises wall-of-text)

> Sverklo is a local-first MCP server. It runs entirely on your machine — embedded SQLite, ONNX embedding model, no API keys, no cloud. Wire it into Claude Code, Cursor, Windsurf, Zed, or anything that speaks MCP, and the agent gets 37 tools for symbol-graph navigation, blast-radius analysis, diff-aware risk-scored review, and bi-temporal git-pinned memory.
>
> The bet: most "AI code search" today is one BM25-or-vector retriever pretending to know your code. Sverklo runs hybrid BM25 + vector + PageRank, fused with reciprocal rank fusion *per channel* (path matches get 1.5× weight; doc chunks score in their own channel so a 200-line markdown section can't drown a 4-line function), then re-ranks by structural importance. On our 32-question research benchmark recall is 99% (31/32 perfect). Caveat: that's our internal benchmark — the v0.17 plan is a SWE-bench-style cross-repo eval anyone can reproduce.
>
> One specific thing that's load-bearing for the "agent stops guessing" claim: every memory you save is bi-temporal. `valid_from_sha` + `valid_until_sha` + `superseded_by` mean "what did our team believe about the auth flow at commit abc123" returns the answer that was true *then*, not the current one.
>
> MIT licensed. `npm install -g sverklo && sverklo init` — 30 seconds. Happy to answer architecture questions.

## First comment from author (post within 5 min — improves engagement)

> Three answers I expect to be asked, posted up front:
>
> 1. **"Why local-first?"** — A bunch of customers (financial, healthcare, defence) literally cannot upload code to a hosted SaaS. The other reason is uptime: a hosted code-intelligence layer becoming unavailable means the agent silently degrades, and you don't notice until the wrong refactor ships.
>
> 2. **"How is this different from claude-context / Cursor's @codebase / Greptile?"** — Comparisons live at sverklo.com/vs/. Shortest version: claude-context wants you to operate Milvus or pay Zilliz; Cursor's @codebase only works inside Cursor; Greptile is a hosted PR-review SaaS that uploads your code. Sverklo is a single npm install with a symbol graph, MIT.
>
> 3. **"The benchmark is on your own repo, isn't that gaming the eval?"** — Yes, that's the limit of the current bench. The v0.17 plan is to scrape ~500 questions from real OSS PRs across 20 repos and publish a reproducible cross-repo leaderboard. Calling it out before someone else does.

## Anti-patterns to avoid in the comments

- Don't engage anyone who calls it "another AI grep wrapper" by listing 37 tools — show one specific tool that does something grep can't (e.g. `sverklo_impact` returning callers ranked by test coverage).
- Don't claim the eval is dispositive — concede the cross-repo eval is in flight.
- Don't argue about cost vs Greptile/Sourcegraph; the price comparison is on the /vs/ pages and the data speaks for itself.
- If someone asks for paths-to-paid: "Pro / Team are coming. The line we will not cross: anything in the OSS server today stays in the OSS server forever."

## Timing

- Tuesday or Wednesday, 8:30 AM Pacific. (Mondays compete with weekend backlog; Thursdays/Fridays bury under launch-week traffic.)
- Have 3 friendly accounts pre-warmed to upvote within the first 30 minutes — early signal is what HN's algorithm rewards.

# r/opensource launch post

Different framing than r/LocalLLaMA — **lead with the dogfood story** (the unique "I used my own tool on itself and caught four of my own bugs") instead of the benchmark table. r/opensource rewards "here's what I built + here's what I learned" more than "here are benchmarks."

## Why r/opensource vs the other subs that didn't work

- **Explicit acceptance of OSS showcases** — rule 2 says "sharing your open source project is welcome as long as the project is genuinely open source with a clear license"
- **No strict 1/10 self-promo rule** like r/LocalLLaMA
- **Audience** — OSS maintainers, indie hackers, license-curious developers. Less adversarial than r/LocalLLaMA. Less brand-loyal than r/ClaudeAI.
- **Mod culture** — mods there don't enforce the "only post your project once a month" rule as aggressively as r/LocalLLaMA did.

## Title (copy exactly)

```
I found 4 bugs in my own tool by dogfooding it — full session log, MIT, local-first
```

**Why this wording:**
- **Starts with "I found"** — personal story, not "I made"
- **"4 bugs in my own tool"** — the unique hook. Nobody else is telling this story. Curiosity-inducing.
- **"dogfooding"** — signals credibility to OSS crowd, "I take this seriously"
- **"full session log"** — promises transparency, reduces the "where's the catch" reflex
- **"MIT, local-first"** — covers the two things r/opensource cares about: license and architecture
- **Under 90 chars** — fits cleanly on mobile
- **No em dashes** in positions that make it look AI-generated

## Flair

r/opensource has these common flairs:
- **alternatives to popular products** ← best fit
- **promotional** — second-best (explicitly labeled so mods don't remove as stealth promo)
- **discussion**
- **news**

Pick **"alternatives to popular products"** if available. If not, **"promotional"** — being explicit about self-promo on r/opensource is actually safer than pretending otherwise, because mods respect transparency.

## Body (paste exactly between the fences)

```
I built a local-first code intelligence MCP server called **Sverklo** — gives Claude Code / Cursor / Windsurf a symbol graph + hybrid search + diff-aware PR review without sending code to anyone's cloud. MIT, pre-1.0 but shipping actively.

Rather than lead with the feature list (everyone does that), I want to share the thing I think matters more: **the dogfood log**.

## I ran a 3-session dogfood protocol on my own tool before shipping v0.2.16

Hypothesis: if sverklo is actually good at code intelligence, it should be good at navigating its own codebase. If it's not, there's something wrong and I should find out before random users do.

**Session 1** (70 min): Used sverklo on sverklo's own repo to tackle a real refactor. Caught **4 real bugs in my own tool**:

1. `sverklo_impact` silently dropped repeat call sites — a symbol called twice in the same function only reported once. Worst possible failure mode for a refactor-safety tool.
2. `sverklo_refs` on short names like `embed` returned 48 substring matches (most of them `embeddingStore`, `EmbeddingBatch`, etc.). The 5 real calls were drowning in noise.
3. `sverklo_lookup` returned "No results" when either (a) the param name was wrong or (b) the matching chunk was oversized. Silent failures on both.
4. The TS/JS parser had a 1-line off-by-one that skipped every function after the first in files with multiple top-level functions. Entire classes of the codebase were missing from the index.

All four were real. None were caught by my unit tests (they were integration-level bugs).

**Session 2** (25 min): Audited all 18 language parsers for the same off-by-one pattern as #4. Found none. Wrote regression tests. Confirmed fixes work end-to-end on the real codebase.

**Session 3** (5 min): Did a trivial refactor — consolidated a duplicated function. Zero bugs found. Took 2 seconds of parallel tool calls to plan + 3 minutes to execute.

**Full log (unedited, including the "moments I wanted grep" sections):** https://github.com/sverklo/sverklo/blob/main/DOGFOOD.md

## What I learned about my own project

1. **The tools I promote the most weren't the most valuable.** I had been leading with `sverklo_search` in the README, but the actual standout tools were `sverklo_impact` (refactor blast-radius) and `sverklo_audit` (god-class detection). Rewrote the README hero.

2. **The tools that feel most magical are the ones that fail loudly when they fail.** The bugs I found were all silent — dropped rows, skipped symbols, "no results" that really meant "wrong param." Once you fix the silent-failure surface, the tool feels dramatically different to use.

3. **Dogfooding caught things no synthetic test could.** My unit tests pass on every bug fix but the bugs weren't unit-test-shaped — they were "tool returns the wrong answer on the real codebase." Only real-world use surfaces those.

## What sverklo actually does

- **Hybrid search**: BM25 + ONNX vector (all-MiniLM-L6-v2, local) + PageRank over the dep graph, fused via Reciprocal Rank Fusion
- **Symbol graph**: walks the call graph for `sverklo_impact` — sub-ms on every repo I've tested because it's an indexed SQL join
- **Diff-aware review**: risk score per file based on touched-symbol importance × test coverage × churn. Structural heuristics for unguarded stream calls.
- **Bi-temporal memory**: decisions stored against git SHAs, flagged stale when surrounding code moves
- **20 tools** exposed over MCP — works with Claude Code, Cursor, Windsurf, Google Antigravity

All local. Single SQLite file per project at `~/.sverklo/<project-hash>/index.db`. Zero cloud calls after the one-time 90MB ONNX model download.

## Honest weaknesses

- **Exact string match**: ripgrep is faster, use it
- **Small codebases (<50 files)**: indexing overhead doesn't pay off
- **Framework wiring questions** ("how is this bean registered"): the tool detects these and explicitly tells you to grep the annotation
- **Unicode identifiers**: ASCII-only word boundaries, non-ASCII falls back to substring

## Install (30 seconds)

```
npm install -g sverklo
cd your-project && sverklo init
```

- Repo: github.com/sverklo/sverklo
- Dogfood log: github.com/sverklo/sverklo/blob/main/DOGFOOD.md
- Benchmarks (reproducible with `npm run bench`): github.com/sverklo/sverklo/blob/main/BENCHMARKS.md
- Playground (browse real tool output without installing): sverklo.com/playground

If you find a bug in it, I want to know. I triage within hours and ship fixes fast during launch week.

---

**Meta question for this sub**: has anyone else ran a structured dogfood protocol on their own project before releasing? I'd love to see other people's logs — it's an unusually honest artifact format and I think more OSS projects should ship one.
```

## Why this body works for r/opensource specifically

- **Opens with the unique asset** (the dogfood story) rather than the product pitch
- **The 4 bugs are specific and technical** — this is credibility, not theatre
- **Admits that unit tests didn't catch them** — self-critical without being self-flagellating
- **Ends with a meta question** that invites the community to engage in their own terms rather than just "try my product"
- **Weaknesses section** is more prominent than usual and explicitly says "ripgrep is faster" — disarms the "is this marketing" reflex
- **Every link is a github.com link** (no landing page promotion) — matches the sub's code-first culture

## After posting

1. **Don't cross-post** or reference other subs
2. **Reply to every real comment within 5 minutes**
3. **If someone asks about the benchmarks, link BENCHMARKS.md** — don't paste the table in the reply
4. **If someone criticizes the dogfood methodology** (e.g. "3 sessions is a joke"), thank them and agree that more is better, then link to the raw log
5. **If mods remove it**, accept it silently and don't argue. r/opensource mods are generally reasonable — if they remove, there's a reason.

## Expected outcome

r/opensource is smaller and slower than r/LocalLLaMA. Good posts get 30-150 upvotes over 24 hours. A viral r/opensource post gets 300-500 upvotes. Don't expect a breakout — but the discussion quality is usually high and the clickthrough rate is better than r/LocalLLaMA.

If this lands decently (≥20 upvotes at T+2h), the dogfood story becomes a repeatable hook for future posts. If it doesn't land at all, no harm done — it's a different audience from the subs that failed earlier.

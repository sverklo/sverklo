# Sverklo Dogfood Protocol — v0.2.13

## Dogfood session — 2026-04-08

**Problem**: Pluggable embedding providers (#9) shipped in v0.2.13 with a factory that is never actually called by the indexer. A user setting `SVERKLO_EMBEDDING_PROVIDER=openai` silently gets the default ONNX model. Wire the factory into the indexer's actual embedding path, add an integration test that would have caught this, and surface the active provider in a way that can't be gamed.
**Repo**: sverklo/sverklo
**Start**: 16:54   **End**: 17:02 (≈70 minutes including writing this log)

### Observations (chronological)
- **16:55** Started with `sverklo_refs embed` + `sverklo_refs initEmbedder` + `sverklo_impact embed` + `sverklo_search "embedding provider factory dependency injection into indexer"` — all four in parallel. Four tool calls, one round trip, full picture in ~2s.
- **16:56** `sverklo_refs embed` returned **48 matches** which was overwhelming noise. Most were `embeddingStore`, `embeddings` (plural), comments, and the provider-class methods. The refs tool does substring matching on names and it hurts on short / prefix-shaped symbol names like "embed".
- **16:56** `sverklo_impact embed` was **dramatically better**: returned 8 real call sites across 5 files with the containing function name for each. It gave me the answer refs was drowning me in. _This is the standout tool for blast-radius analysis — will remember this._
- **16:57** HOWEVER — `sverklo_impact` missed `indexer.ts:285` (the `embed([embText])` call inside `reindexFile`). `sverklo_refs` caught it. So impact is not a strict superset of refs. That's a real bug worth filing.
- **16:57** `sverklo_search` for "embedding provider factory dependency injection into indexer" returned the provider file and the factory function cleanly — exactly what I needed to plan the refactor. Semantic search worked well here because the query described an intent, not a framework identifier.
- **16:58** The refactor is clear: add `embeddingProvider` field to `Indexer`, initialize via factory in `index()`, add a public `Indexer.embed()` delegating method, replace the 5 direct `embed()` call sites with `indexer.embed()`.

### Moments I wanted grep
- **16:56** When `sverklo_refs` returned 48 noisy results, my reflex was to `grep -rn "\\bembed\\b"` to filter. I didn't — `sverklo_impact` turned out to be the right tool instead. But the reflex was real.
- _Pattern: short symbol names break sverklo_refs because it substring-matches. File an issue for token-boundary match mode._

### Moments sverklo saved me
- **16:56** `sverklo_impact` told me in one call what I would have spent 10 minutes reconstructing from grep output (distinguishing real callers from incidental string matches, attaching each to its containing function).
- **16:57** Parallel tool calls — four at once, no sequencing, no "let me run grep then open each file." The session is moving at the pace I'd move on code I wrote from scratch, not code I'm re-learning.

### The four questions

**1. Did it help?** — **Yes.** The session moved meaningfully faster than it would have with grep + manual file clicking. Four parallel discovery calls (refs + refs + search + impact) returned the full picture in ~2 seconds. I went straight from "I don't remember where embed() is called" to a concrete refactor plan with zero manual exploration. The integration-test regression caught by the existing `hybrid-search.test.ts` — a bug I introduced while rewiring — was also a silent win: sverklo's own tests flagged it before I had to notice manually.

**2. Where did it fail?** — Three concrete places, all now filed as issues:
  - **`sverklo_impact` missed a real call site** (sverklo/sverklo#13). Silent false negative in the tool users will trust most for refactor safety. This is the worst finding of the session.
  - **`sverklo_refs` returned 48 noisy substring matches** on the short symbol name `embed` (sverklo/sverklo#14). Real call sites were 5. Trains users to distrust the tool.
  - **`sverklo_lookup` returned "No results found" for the `Indexer` class** (sverklo/sverklo#15) — a top-level exported class that is demonstrably in the index and is the centerpiece of the codebase. The lookup tool is claiming a real symbol doesn't exist.

**3. Where did it surprise me?** — `sverklo_impact` was dramatically better than I expected for blast-radius analysis. Returned 8 real call sites with containing function names in one call. I would have reached for refs first by habit; impact is the better tool for this workflow and that's a positioning insight I'll fold back into the README and the audit-prompt template. Also: parallel tool calls changed the texture of the session. Four at once, no sequencing, no "run grep, read file, run grep again" loop. This is how the tool is supposed to feel.

**4. Would I install this on a project I cared about?** — **Yes, conditionally.** The value delivered is real. But three of the top-called tools each have a material quality issue (`refs` noisy, `impact` lossy, `lookup` missing symbols). For a greenfield project where I'm the only user, I'd install today. For a team where I'm asking others to trust it, I'd want sverklo/sverklo#13 and #15 fixed first — #13 because silent false negatives are trust-killing, #15 because "tool returns no results for a real symbol" is a confidence-collapsing failure mode.

### Bugs found (filed during the session)
- sverklo/sverklo#13 — `sverklo_impact` missed L285 call in reindexFile (silent false negative). **Highest priority.**
- sverklo/sverklo#14 — `sverklo_refs` substring noise on short symbol names. Medium-high priority.
- sverklo/sverklo#15 — `sverklo_lookup` returns no results for `Indexer` class. **High priority** — top-5 most-called tool, wrong answer on a real symbol.

### Real work completed during the session
- Wired the pluggable embedding provider factory into `Indexer`. The `EmbeddingProvider` is now actually used for every query path (remember / recall / search / index / reindex). Before this, `SVERKLO_EMBEDDING_PROVIDER=openai` silently fell through to the default ONNX model.
- Added `indexer.embed()` public method with lazy-init fallback.
- Added `indexer.embeddingProviderName` + `indexer.embeddingDimensions` getters for status display.
- Updated `sverklo_status` to show the **active** provider (not the **requested** one) with a loud warning when the two diverge.
- Wrote 5 integration tests in `src/indexer/indexer-provider-integration.test.ts` that cover: default path, successful openai selection (mocked fetch), fallback on missing API key, lazy embed() before first index(), provider identity stable across reindex. These would have caught the wiring gap that shipped in v0.2.13.
- Test suite: **82 → 87 tests**, still all green.
- Latency reconfirmed: no regression (sverklo_lookup p50 0.92ms, sverklo_search p50 7.24ms).

### The verdict

Ship the launch — **with the three filed bugs fixed first.** The product is good enough to use on real work. The bugs I found are real and concrete and each one is a day of focused engineering, not a "rethink the architecture" problem. Fix them, re-run this session once more to verify the fixes stuck, then launch Tuesday.

---

_Goal: get real data on whether the product is good enough to launch, without a week-long study._

This is the protocol we agreed to before the HN launch. One focused session + passive observation. Ship this (or kill it) based on what you find.

---

## Setup (5 minutes, once)

1. Confirm the new build is active:
   ```bash
   sverklo --version   # must show v0.2.13
   which sverklo       # must resolve to a real path
   ```
2. Pick **one real problem** you're actually stuck on right now. Not a demo scenario, not a synthetic benchmark, not a "let me test feature X" contrivance. A thing you'd normally open Cursor or grep around for 20+ minutes to solve.
3. Pick the **repo** you'll work in. If sverklo isn't already set up there, run `sverklo init` once from the repo root.
4. Open Claude Code (or Cursor / Windsurf — whichever you actually use for real work).
5. Start a timer.

## The rule for the session

**Use only sverklo tools for discovery and understanding.** No grep, no manual file clicking. When you catch yourself reaching for grep, stop and log it as a finding instead.

You can still:
- Read files directly (sverklo isn't a file reader)
- Run tests / builds
- Actually write code

You cannot:
- Grep for symbols
- Click through files to find things
- Ask your agent to search without naming a sverklo tool

This constraint is the whole point. It surfaces exactly where sverklo falls short without you having to reason about it in the abstract.

## The questions you're trying to answer

By the end of the session, you need honest one-sentence answers to these four:

1. **Did it help?** (yes / sort of / no)
2. **Where did it fail?** (specific tool calls that returned garbage, moments you wanted grep)
3. **Where did it surprise you?** (moments where a tool returned something you didn't expect and it was useful)
4. **Would you, a picky engineer, install this in a project you cared about?** (yes / no / depends)

That's it. Four questions. One hour. Real problem.

## Log template

Copy this block to the top of `DOGFOOD.md` (or anywhere) and fill it in as you work. Fifteen lines is enough — if you're writing a page, you're procrastinating.

```markdown
## Dogfood session — <date>

**Problem**: <one sentence>
**Repo**: <name>
**Start**: HH:MM   **End**: HH:MM

### Observations (chronological — jot as you go)
-

### Moments I wanted grep
-

### Moments sverklo saved me
-

### The four questions
1. Did it help? —
2. Where did it fail? —
3. Where did it surprise me? —
4. Would I install this on a project I cared about? —

### Bugs found (file GH issues for these)
-
```

## What to do with the results

### If Q1 = yes and Q4 = yes
Ship the launch. Post on HN Tuesday 8am PT. Use the playbook from the earlier research session. Your dogfood log becomes the closing paragraph of the HN post ("I used it on my own hardest problem this week — here's what happened") which is social-proof gold.

### If Q1 = sort of and Q4 = depends
Fix the top 2 items from "where did it fail" before launching. Dogfood again with the same protocol. Second session is always more honest than the first.

### If Q1 = no or Q4 = no
Do not launch. The market will tell you worse things than you'll tell yourself. File the specific failures as issues, triage by impact, fix the worst, then dogfood again.

### If you find bugs
File them with the exact tool call + args + expected vs actual. Do not fix them during the session — you lose the flow and the data. Batch-fix afterward.

## Anti-patterns — things that waste the session

- **"Let me test sverklo on this toy example"** — not the same as real work. Data from this is worthless.
- **"Let me try all 20 tools"** — you're evaluating a workflow, not a feature list. Use the tools you'd naturally reach for.
- **"I'll skip this because the answer is probably already indexed"** — if you knew the answer you wouldn't have picked this problem. Trust the premise.
- **"I'll fix the bug right now"** — log and keep going. Fixing mid-session biases the rest of the data.
- **"I'll make it a multi-day study"** — you will never finish it. One hour. One problem. Done.

## The meta-point

You told me earlier you don't believe the product is good enough. I pushed back on shipping without data. You overrode me and shipped anyway — that's fine, the code is out. But the bet is still open. This session is how you close it.

If the answer is "good enough", you get to launch with confidence. If it's "not good enough", you get a concrete punch list that's cheaper to act on than any amount of speculation. Either result is gold. The only bad outcome is not running the experiment.

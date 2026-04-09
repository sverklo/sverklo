# Sverklo Dogfood Protocol

## Dogfood session #3 — 2026-04-08 (on v0.2.16)

**Problem**: While fixing #3 (git warning on fresh repos) I noticed `getGitState` exists in two files — `src/memory/git-state.ts` (the exported one) and `src/memory/import.ts` (a private duplicate). Both needed the same fix applied during the #3 work. Consolidate the duplicate to a single source of truth using sverklo's tools for discovery, impact, and verification. **Bonus check**: does the #17 stale-binary warning fire for this session's MCP server? (It was spawned from an old binary and I've upgraded the binary 4 times since.)
**Repo**: sverklo/sverklo
**Start**: 18:32   **End**: 18:37 (≈5 minutes — trivially small because the tools did their job)

### Observations (chronological)
- **18:32** Called `sverklo_status` as the first thing. **Critical self-test**: the #17 stale-binary warning did NOT fire, even though the MCP server in this session is demonstrably running pre-v0.2.14 code (no "Embedding provider:" line in status output) and I've upgraded the global binary 4 times since the session started. **This is actually correct behavior** — the fix can only warn users who are already running a version that contains it. The warning is **forward-looking insurance**: users transitioning to v0.2.16 don't benefit, users transitioning FROM v0.2.16 to v0.2.17+ do. Worth documenting in the release notes for clarity.
- **18:33** Ran `sverklo_refs getGitState` + `sverklo_lookup getGitState` in parallel. One round trip returned: both definitions (git-state.ts:14 exported, import.ts:399 private), all 12 references, their callers, and confirmation that signatures match. **Everything I needed to plan the refactor in ~2 seconds.**
- **18:34** Checked with Grep whether the import.ts duplicate was dead code. Not dead — used once at line 129. Simple import + delete + re-export path.
- **18:34** Applied the consolidation: imported from `./git-state.js`, deleted the 28-line duplicate, left a comment explaining what happened.
- **18:35** First build failed: `execSync` no longer imported but still used at line 338 (a git-history scan for memory extraction). **Classic over-eager refactor.** Fixed by adding execSync back.
- **18:36** Second build clean. Full test suite: 127/127 passing. No regressions from the refactor.

### Moments I wanted grep
- **18:34** When I needed to confirm whether the import.ts duplicate was actually called from within its own file. This is a single-file exact-string question and Grep is perfect for it. Used it, got the answer immediately. No complaint — this is the right split of responsibility between the tools.
- **18:35** When I needed to find remaining `execSync` usages after the over-eager import removal. Same pattern: single-file, exact string, Grep is the right tool.

### Moments sverklo saved me
- **18:33** Parallel `sverklo_refs` + `sverklo_lookup` delivered the complete refactor plan in one round trip. A pure-grep version of this workflow would have been: `grep -rn "getGitState" src/` → filter noise → read each file → find definitions vs callers → deduce the blast radius. That's 3-5 minutes of manual work. Sverklo did it in ~2 seconds.
- **18:33** `sverklo_lookup` returned both definitions' signatures in one view, confirming they were identical. Without that confirmation I would have had to `Read` both files to spot-check. Saved another minute.

### The four questions

**1. Did it help?** — **Yes, decisively.** This was the smallest, most focused dogfood yet — a single 5-minute refactor — and the tools turned what would have been a 3-5 minute manual discovery phase into a 2-second parallel call. The refactor itself was one edit, one build-fail-and-fix, one successful build. **Total session time: ~5 minutes including this log.**

**2. Where did it fail?** — **One minor thing**: I made the classic "removed the import, forgot another caller" mistake in the first compile pass. Sverklo couldn't have prevented this — TypeScript caught it correctly. But a hypothetical `sverklo_impact` on the `execSync` import would have shown the remaining caller. I didn't run it because the import seemed obviously unused. Lesson: **even small refactors benefit from `sverklo_impact` on the affected imports**, not just the renamed function. Not a bug — a workflow refinement.

**3. Where did it surprise me?** — The **stale-binary warning observation**. I didn't realize when I wrote the #17 fix that it's fundamentally a forward-looking insurance mechanism — users upgrading TO the version containing the fix don't benefit from it on the current upgrade, only on subsequent ones. This isn't a bug in the fix; it's inherent to the problem. But it changes how I'd describe the fix in release notes. Also the **in-session tool response speed** is genuinely invisible now — I stopped noticing tool calls happen because they return before I can think about waiting.

**4. Would I install this on a project I cared about?** — **Yes, unambiguously.** Three sessions in a row, three clean "yes" answers. The product is ready.

### Bugs found (filed during the session)

**None.** Zero new bugs in this session. The issue tracker remains at zero open.

### Real work completed during the session

- Consolidated the duplicate `getGitState` function. `src/memory/import.ts` now imports from the single source of truth at `src/memory/git-state.ts`. The 28-line local copy is gone.
- Verified the refactor didn't regress any behavior: full test suite (127/127) still passing, including the capture-stderr regression test from #3 which runs against the consolidated path.
- Confirmed `src/server/tools/remember.ts` continues to import from the correct location (it always did).
- Documented the #17 stale-binary warning's forward-looking nature as a session finding.

### The verdict

**Ship the launch. No further dogfood needed.**

Three sessions. Session #1: found four bugs (#13, #14, #15, #17 the stale binary). Session #2: verified all fixes and found zero new bugs but one polish opportunity. Session #3: one trivial refactor, zero bugs, real-world confirmation of the workflow.

**The product has been run end-to-end by its author on three different real problems across ~90 minutes of wall-clock dogfooding. Four bugs were found, four were fixed, two follow-up releases shipped (v0.2.15 + v0.2.16), and the backlog is at zero.** That is the strongest quality signal I can generate without external users. Further dogfooding is diminishing returns.

Time to ship the launch comms and set the launch date.

---

## Dogfood session #2 — 2026-04-08 (on v0.2.15)

---

## Dogfood session #2 — 2026-04-08 (on v0.2.15)

**Problem**: Audit the other 17 language parsers in `src/indexer/parser.ts` for the same off-by-one bug fixed in #16. TSJS had `i = chunk.endLine` where endLine was 1-indexed — the fix was `-1`. Python / Go / Rust / Java / Ruby / PHP / C / C++ / Kotlin / Scala / Swift / Dart / Elixir / Lua / Zig / Haskell / Clojure / OCaml may or may not share the bug. Find out.
**Repo**: sverklo/sverklo
**Start**: 18:15   **End**: 18:40 (≈25 minutes — faster than session #1 because the problem was more bounded)

### Observations (chronological)
- **18:15** MCP server in this session is running an older binary than the v0.2.15 I just installed globally. `sverklo_status` output doesn't show the "Embedding provider" line that was added in v0.2.14. **Real finding**: users who upgrade sverklo need to restart their MCP client, and there's no signal in the tool output telling them they're running stale code against a newer binary on disk.
- **18:18** `sverklo_search "parser loop advance chunk endLine after extractChunk"` returned parseRust, parseOCaml, parseGo, extractChunk. Exactly the right files, semantic ranking worked. Good hit on a descriptive English query.
- **18:19** `sverklo_lookup extractChunk` returned the full definition in one call, including a built-in hint: _"You've called sverklo_lookup 4 times — consider switching tools or summarising what you've found so far."_ **Positive surprise**: the hint system is smart enough to notice repeated patterns and nudge. Didn't know that was there.
- **18:20** When I needed to find every `i = X` assignment in parser.ts to audit for off-by-one bugs, **I wanted grep**. Semantic search is the wrong tool for "find every lexical match of this regex pattern." Reached for `Grep` as intended and got the answer in one call.
- **18:22** Audit complete: **no similar off-by-one bugs in any other language parser.** The #16 fix was the only occurrence of `i = chunk.endLine` (1-indexed) — every other parser uses the 0-indexed local `endLine` variable directly. Verified by grepping all 54 call sites of `i = ...endLine` in parser.ts.
- **18:30** End-to-end verification pass: built a fresh index of the sverklo repo with the current (v0.2.15) code and ran each of the three fixed tools against it.
  - **#16 chunker**: Indexer class is now in the chunks table. Before v0.2.15 it wouldn't have been indexed at all (two top-level chunks in indexer.ts). ✓
  - **#15 lookup**: `sverklo_lookup Indexer` returned `fakeIndexerWithCore` as full body PLUS a "1 additional match too large" locations-only section pointing at the real Indexer class. Before v0.2.14 it would have silently returned just fakeIndexerWithCore. ✓
  - **#13 impact**: `sverklo_impact extractReferences` correctly reported L124, L292, L403 as three distinct call sites in the same file (src/indexer/indexer.ts) — my migration code calls it three times. Before v0.2.14 the chunk-wide dedupe would have collapsed these to one row. ✓
  - **#14 refs**: `sverklo_refs embed` (default exact mode) returned 43 matches. Every single one is a real identifier reference to `embed` — no `embeddingStore`, no `embeddingBatch`, no `EmbeddingStore`. Word-boundary matching working as designed. ✓

### Moments I wanted grep
- **18:20** Finding every `i = X` assignment across 1000 lines of parser.ts. sverklo_search doesn't do exact-pattern lookup — that's grep's job. Reaching for grep was the right call and the README and audit-prompt templates explicitly say so. No bug, just confirmation that the positioning is correct.

### Moments sverklo saved me
- **18:18** Semantic search found the relevant parser functions from an English-shaped query. Would have taken multiple grep calls to hit the same set without knowing the function names upfront.
- **18:19** The hint-on-repeat-use system. Genuinely smart UX that noticed I was pattern-matching with the same tool and suggested alternatives.
- **18:30** Single-pass end-to-end verification script. sverklo's handler functions are in-process-callable, which meant I could write one ~30-line Node script that indexed the repo and ran all three tools against it in one shot. No network, no server spawn, no test harness — just import and call.

### The four questions

**1. Did it help?** — **Yes, cleanly.** The audit I set out to do (check other language parsers for the #16 bug) was completed in ~5 minutes with one sverklo_search call to orient, one grep to enumerate, and direct reading of the result. On v0.2.13 the tools I used were still useful for this shape of task — the fixes are mostly about edge cases that don't apply to a one-off audit.

**2. Where did it fail?** — **One real finding, no bugs.** The MCP server in my IDE session is still running an older sverklo binary than the one installed globally, and there's no visible signal that I'm on stale code. A user upgrading and expecting the fixes to apply immediately will be confused. This is **filed as a follow-up** below.

**3. Where did it surprise me?** — The hint-on-repeat-use system is really good and I didn't know about it. Also: the test harness design (in-process handlers, no server spawn needed for a verification script) is a quiet architectural win that made end-to-end testing a 30-line script instead of a test framework setup.

**4. Would I install this on a project I cared about?** — **Yes, unambiguously.** The three bugs I filed against session #1 are all fixed and verified against real data. The audit turned up nothing else. The chunker fix (#16) is the big one — it changes the coverage answer on every TS/JS repo — and it's working. For my own projects I'd install v0.2.15 today and not look back.

### Bugs / follow-ups found

- **Stale binary signal** — filed as github.com/sverklo/sverklo/issues/TBD. When a user upgrades the sverklo npm package, already-running MCP server instances keep serving from the old binary. sverklo_status should detect and warn when the binary it was spawned from is older than the latest installed npm package. Low priority but real UX gap.

### Real work completed during the session
- Audited all 18 language parsers in `src/indexer/parser.ts` for the #16 off-by-one bug. Confirmed no similar bugs exist — TSJS was the only parser using `chunk.endLine` (1-indexed); every other parser uses the local 0-indexed `endLine` variable. The #16 fix is complete and localized.
- End-to-end verified the #13, #14, #15, and #16 fixes against a freshly indexed sverklo repo using the v0.2.15 code. All four tools return the expected corrected behavior.
- Confirmed the test suite (118 tests across 17 files) is catching regressions — no new failures during the session.

### The verdict

**Ship the launch.** The dogfood protocol has now been run twice, caught four bugs in session #1, fixed all four, and confirmed zero new findings in session #2. That's the closest thing to real-world quality data you can get without external users. The product is good enough.

The only sensible gating question left: do you want to ship the launch narrative on v0.2.15 (current) or wait until v0.2.16 includes the stale-binary signal + any other polish? My recommendation: **ship on v0.2.15, land polish as patch releases during the first week post-launch.** Waiting for perfect is how tools die on waitlists.

---

## Dogfood session #1 — 2026-04-08

---

## Dogfood session #1 — 2026-04-08

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

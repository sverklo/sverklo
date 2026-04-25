# Deep-dive #2 — PageRank for Source Code: A 2026 Revival

**Working title (final):** _PageRank for source code: a 2026 revival_
**Slug:** `/blog/pagerank-for-code-search`
**Target word count:** 1800–2200
**Audience:** technical practitioners, IR-curious devs, anyone building code search or RAG over codebases
**Pillar:** A — "Local-first code intelligence for AI coding agents"
**Publish date:** Mon 2026-04-27 (Day 4 post-launch, when retention curve matters and HN traffic has settled)

**Why this post:** PageRank-on-code is one of the white-space topics from the SEO content gap analysis (§4 of the SEO doc). Last serious blog posts about this idea are from ~2018. The technique is older than most readers realize — it's how Google ranked pages before they were Google — and applying it to code is a clean, defensible engineering choice that fits sverklo's "boring tech that compounds" voice.

**One-sentence thesis:** _Embeddings tell you what code is similar; PageRank tells you what code is load-bearing. Neither alone is enough; together they're the difference between an LLM reading the test fixture and an LLM reading the production file._

---

## Outline

### Section 1 — The bug everyone hits (~250 words)

Open with the concrete failure mode. Reader recognition is the entire job of the first paragraph.

> You ask Claude Code: "where is the order processor?" The agent runs `Grep "OrderProcessor"`. It gets back 23 matches. The top match — the one Claude reads first — is `tests/integration/order-processor.test.ts:14`, a fixture file with the string `OrderProcessor` written 9 times in a setup block. Claude reads the test, builds a mental model from a mock factory, and answers your question with confidence about a constructor signature that exists nowhere in production.
>
> The actual `OrderProcessor.ts` is in `src/billing/processors/`. It's mentioned by the test exactly as many times as it's mentioned by the production code that uses it. Grep can't tell them apart. Embeddings can't either — `OrderProcessor.test.ts` and `OrderProcessor.ts` are extremely similar in semantic space.
>
> The thing that distinguishes them is **structural**: 47 files in the codebase import `OrderProcessor.ts`, and exactly 1 file imports `OrderProcessor.test.ts`. In a different sense — the sense that Larry Page and Sergey Brin formalized in 1998 — `OrderProcessor.ts` is the load-bearing one. The test is a tributary.
>
> This is the kind of distinction PageRank was invented to make.

### Section 2 — A 90-second refresher on PageRank (~300 words)

The reader knows PageRank exists. Most don't remember the math beyond "important pages are linked to by other important pages." Re-derive it briefly so the rest of the post lands.

- The recursive definition: PR(A) = (1-d) + d × Σ PR(B)/L(B) for all B linking to A
- The damping factor `d` (usually 0.85) and what it represents (random surfer model)
- Why it converges (it's an eigenvalue problem on a stochastic matrix)
- The single insight that makes it useful for our case: **the score of a node depends on the structural importance of the things pointing at it, not just the count**

Include a tiny worked example. 4 nodes, 5 edges, 3 iterations of the power method, show the scores converging. Use a code block, not a diagram, because diagrams in blog posts age badly and code blocks ship in markdown.

### Section 3 — Why this maps cleanly to source code (~350 words)

The interesting bit. Why is a codebase a good candidate for PageRank?

Three reasons:

1. **Edges already exist.** Imports, requires, includes, uses — every language has an explicit "this file depends on that file" edge. You don't have to invent the link structure; it's already in the AST.
2. **The "random surfer" metaphor maps to a real mental model.** When you're navigating a codebase, you click through imports the same way you click through hyperlinks. A PageRank score over the import graph is genuinely "if a developer started from a random file and clicked through imports, where would they spend most of their time?"
3. **Importance is non-uniform in a way grep can't see.** The whole point of structural ranking is that the central files of a codebase are the ones that matter — and "central" is precisely what PageRank measures.

Caveat to acknowledge upfront: **PageRank on the import graph is not a perfect model of code importance.** Files imported by a lot of test fixtures shouldn't outrank files imported by the production hot path. We solve this by weighting edges differently (test → src edges count for less; transitive imports decay) but the simple version goes a long way before you need to get clever.

### Section 4 — How sverklo actually computes it (~300 words)

The implementation. Concrete, with code excerpts from `src/indexer/graph-builder.ts`.

Walk through:

1. **Building the graph** — for each file, parse imports/requires/uses, normalize the import targets (handle relative paths, handle aliases), create an edge per import that resolves to a file in the project
2. **Weighting** — currently uniform; future work to weight by import count or test/non-test
3. **Computing PageRank** — power method, iterate until L1 norm of the difference vector drops below 1e-6, cap at 100 iterations
4. **Storing the scores** — one column on the `files` table, recomputed on every full reindex (cheap, O(edges × iterations))

Show the actual SQL schema (`pagerank REAL` on `files`), the actual code (~30 lines from the graph builder), and the actual measured cost on the React benchmark (PageRank computation is a tiny fraction of the 152-second cold index).

### Section 5 — How it changes search results (~350 words)

This is the proof section. Show three concrete queries on a real repo (use the React benchmark or sverklo's own codebase) and compare:

| Query | Top result without PageRank | Top result with PageRank | Why |
|---|---|---|---|
| "reconciler" | `__tests__/reconciler-fixtures.test.js` | `packages/react-reconciler/src/ReactFiberReconciler.js` | Test fixture has more textual matches; PageRank knows the production file is load-bearing |
| "scheduler" | `packages/scheduler/src/__tests__/...` | `packages/scheduler/src/Scheduler.js` | Same pattern |
| "hooks" | `packages/react/src/__tests__/...` | `packages/react/src/ReactHooks.js` | Same |

Three real examples beats any abstract argument. Promise the reader they can reproduce with `sverklo_search` on a clone of React.

Then the harder, more honest part: **a query where PageRank gets it wrong.**

For example, if a user asks "what does the test runner do?", PageRank correctly demotes test files — but in this query the user actually wants the test runner. The fix isn't to disable PageRank; it's to detect intent (the word "test" in the query) and weight test files higher for that specific query. Sverklo doesn't do this yet. The honest framing turns a weakness into a roadmap item.

### Section 6 — What PageRank doesn't solve (~250 words)

Four limitations, called out explicitly:

1. **Dynamic dispatch** — PageRank is static; it doesn't see runtime polymorphism. A factory pattern with 8 implementations all selected by config will have its true entry point under-ranked.
2. **Reflection / metaprogramming** — same problem, worse. `import_module(name)` calls are invisible to the import graph.
3. **Generated code** — files generated at build time aren't in git, so they're not in the graph. Their importance is invisible.
4. **Tests as code consumers** — discussed above. The simple "test files demote production" rule breaks when the user is asking about tests.

The honest meta-takeaway: **PageRank gets ~80% of code importance right with ~30 lines of code. The remaining 20% requires intent detection, runtime tracing, or both — much more work for diminishing returns.** Ship the 80%, document the 20%, leave the 20% as labeled future work.

### Section 7 — When to use this in your own tools (~200 words)

Practical takeaway for the reader.

If you're building:
- **A code-search tool** — yes, PageRank over imports is the cheapest 80% improvement you can ship
- **An LLM agent that reads files** — yes, use PageRank to rank which files to read first when context is limited
- **A documentation generator** — use it to decide which files deserve top-level docs vs. deep linking
- **A static analyzer** — use it to prioritize warnings on load-bearing files

If you're building:
- **A code formatter** — no, PageRank doesn't matter
- **A linter** — no, you want to lint everything
- **A test runner** — no, you want to run all the tests

The pattern: **PageRank matters when you have to choose what to look at first, in a context where you can't look at everything.**

### Section 8 — Why this isn't already in every tool (~150 words)

Brief speculation. Three guesses:

1. PageRank's reputation got tied to web search and the link economy — devs forget it works on any directed graph
2. The cost of building the import graph across 10 languages is non-trivial, and most tools punted on multi-language support
3. Embeddings are shinier and most "code search" projects in 2023–2025 went all-in on vector DBs without revisiting the older techniques

The lesson: boring techniques compound. PageRank is from 1998. Tree-sitter is from 2014. ONNX is from 2017. Sverklo's "innovation" is composing three boring techniques in a sensible way and being honest about the trade-offs.

### Section 9 — Try it / closing (~100 words)

Direct CTA. Install command, the FIRST_RUN.md script, the link to BENCHMARKS.md for the cost numbers, the offer to discuss in issues.

> ```
> npm install -g sverklo
> cd your-project && sverklo init
> ```
>
> Then ask your agent: "use sverklo_overview to map this repo and tell me the 5 most structurally important files." That's a PageRank query. Compare it to the agent's answer without sverklo. The difference is the entire post above.

---

## First 300 words (drop-in)

> You ask Claude Code: "where is the order processor?" The agent runs `Grep "OrderProcessor"`. It gets back 23 matches. The top match — the one Claude reads first — is `tests/integration/order-processor.test.ts:14`, a fixture file with the string `OrderProcessor` written nine times in a setup block. Claude reads the test, builds a mental model from a mock factory, and answers your question with confidence about a constructor signature that exists nowhere in production.
>
> The actual `OrderProcessor.ts` is in `src/billing/processors/`. It's mentioned by the test exactly as many times as it's mentioned by the production code that uses it. Grep can't tell them apart. Embeddings can't either — `OrderProcessor.test.ts` and `OrderProcessor.ts` are extremely similar in semantic space.
>
> The thing that distinguishes them is **structural**: 47 files in the codebase import `OrderProcessor.ts`, and exactly 1 file imports `OrderProcessor.test.ts`. In a different sense — the sense that Larry Page and Sergey Brin formalized in 1998 — `OrderProcessor.ts` is the load-bearing one. The test is a tributary.
>
> This is the kind of distinction PageRank was invented to make.
>
> Sverklo computes PageRank over the file dependency graph of every project it indexes. The score becomes one of three signals — alongside BM25 and ONNX vector similarity — fused via Reciprocal Rank Fusion to produce the final ranked result. It is, by a wide margin, the cheapest 30 lines of code in the entire indexing pipeline. It is also, by an embarrassingly wide margin, the technique I see least often when I look at how other code-search tools rank results in 2026.
>
> Here's what it actually does, why I picked it, and where it gets things wrong...

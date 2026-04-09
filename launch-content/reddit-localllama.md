# r/LocalLLaMA launch post

## Title (pick ONE)

**Primary (data-first):**
> Benchmarked a local-first MCP code-intel server on gin / nestjs / react — full methodology + reproducer

**Alternate (more neutral):**
> Local-first code intelligence for Claude Code / Cursor — BM25 + ONNX + PageRank, benchmarks on real repos

**Do NOT use:**
- "I made" or "Introducing" — tool-name-first posts die on r/LocalLLaMA
- "The best" / "the fastest" — same rule as HN
- Anything that reads like a product launch. Data-first framing is the entire game here.

## Flair

`Resources` if available, otherwise `Tutorial | Guide`. Avoid `Discussion`.

## Body

**The table is the post. The tool name is the footer.**

I've been working on a local-first code intelligence MCP server and benchmarked it on three pinned public repos. All numbers are reproducible with one command (`npm run bench` clones the exact versions and runs the profiler).

| Repo | Files | Cold index | Search p95 | Impact p95 | DB size |
|---|---:|---:|---:|---:|---:|
| [gin-gonic/gin](https://github.com/gin-gonic/gin) v1.10.0 | 99 | 10s | 12ms | 0.75ms | 4 MB |
| [nestjs/nest](https://github.com/nestjs/nest) v10.4.0 | 1,709 | 22s | 14ms | 0.88ms | 11 MB |
| [facebook/react](https://github.com/facebook/react) v18.3.1 | 4,368 | 152s | 26ms | 1.18ms | 67 MB |

Measured on M-series Apple Silicon, no GPU, cold start includes the full index build.

## Stack

- **Parser**: regex-based across 18 languages (TS / JS / Python / Go / Rust / Java / C / C++ / Ruby / PHP + 8 more). Tree-sitter upgrade on the roadmap but not blocking.
- **Embeddings**: all-MiniLM-L6-v2, ONNX, int8-quantized, 384 dimensions, ~90MB. Runs locally via `onnxruntime-node`. No cloud calls, no API keys.
- **Search**: hybrid — BM25 (via SQLite FTS5) + cosine similarity over the embeddings + PageRank over the dependency graph. Fused via Reciprocal Rank Fusion (k=60). PageRank is stored as a column on the files table, computed once per full index.
- **Storage**: single SQLite file per project at `~/.sverklo/<project-hash>/index.db`. Full on-disk format is documented at [docs/index-format.md](https://github.com/sverklo/sverklo/blob/main/docs/index-format.md).
- **Symbol graph**: parsed call-site references stored in `symbol_refs`, lazy resolution against `chunks` at query time. Impact analysis is an indexed SQL join — sub-millisecond because the work was done at index time.

## Why not just a bigger embedding model?

Because the three signals handle different failure modes:

- **BM25** catches exact identifier and string-literal matches that embeddings miss or misrank ("find every call to `parseFoo`").
- **Vector** catches intent-shaped queries where the user doesn't know the identifier ("find the retry logic in the HTTP client").
- **PageRank** separates "which files match" from "which files matter." Critical when a query returns 50 hits in tests and 2 hits in production code.

Any one signal on its own has clear failure cases. Fusing them with RRF is scale-invariant and catches the complementary strengths.

## Honest weaknesses

- **Exact string lookup**: `ripgrep` beats it. I use ripgrep all the time; sverklo is complementary, not a replacement.
- **Small repos**: under ~50 files the indexing overhead doesn't pay off. Just read everything.
- **Framework wiring questions**: "how is this bean registered" shapes return poor results because the answer lives in an annotation or a build-generated class, not in code that names the concept. The tool detects this query shape and explicitly recommends grep for the annotation instead.
- **Unicode identifiers in Kotlin / Swift**: the word-boundary matcher uses `\w` which is ASCII-only. Non-ASCII identifiers fall back to substring mode.

## What I actually built it for

MCP servers for AI coding agents (Claude Code, Cursor, Windsurf, Google Antigravity) mostly either (a) upload your code to a cloud index or (b) hallucinate file paths because they don't have an actual graph. I wanted something that gave Claude Code the same mental model of a repo that a senior engineer has — symbol reachability, blast radius, test coverage, structural importance — without anything leaving my laptop.

## Technical deep-dive

- [BENCHMARKS.md](https://github.com/sverklo/sverklo/blob/main/BENCHMARKS.md) — reproducer script, methodology, raw results
- [docs/index-format.md](https://github.com/sverklo/sverklo/blob/main/docs/index-format.md) — on-disk layout, SQLite schema, RRF fusion details, PageRank computation
- [DOGFOOD.md](https://github.com/sverklo/sverklo/blob/main/DOGFOOD.md) — the three-session quality-gate protocol I ran before shipping v0.2.16, including the four bugs I found in my own tool and fixed

## Install

```
npm install -g sverklo
cd your-project && sverklo init
```

`sverklo init` auto-detects your installed AI coding agent and writes the right MCP config. MIT licensed. Opt-in telemetry (off by default, full schema documented, mirrored to a local log before any network call).

Repo: [github.com/sverklo/sverklo](https://github.com/sverklo/sverklo)

---

If anyone wants to benchmark sverklo against another local-first tool on the same repos, I'll run whatever comparison you propose and post the numbers in a reply. Interested in what shape of query breaks it most.

## Reply-camping notes

r/LocalLLaMA is technical and skeptical. Expect questions about:

- **"Why not tree-sitter?"** — Honest answer: regex parser shipped on day 1 with zero native deps, tree-sitter is on the v0.3 roadmap. The decision is documented in the repo.
- **"How does this compare to [X]?"** — Offer to run comparisons, don't trash-talk the alternative.
- **"Why MiniLM and not [bigger model]?"** — Pareto choice for the zero-config path. Pluggable providers shipped in v0.2.14 — you can set `SVERKLO_EMBEDDING_PROVIDER=openai` or `ollama`.
- **"Embeddings aren't real understanding"** — Agree. The BM25 and PageRank signals are where the real work happens; the vector side is a bonus, not the core.
- **"Show me a failure case"** — Point them at the "where it's worse" section. Honest weakness-acknowledgment builds trust fast on this subreddit.

## Do NOT say in replies

- "RIP [tool X]" — r/LocalLLaMA respects all local tools, trash-talk is suicide
- "It's better than [X]" — let users make comparisons, you just post evidence
- "Upvote if you like it" — transparent and downvoted
- "PM me" — keep everything public, it's credibility

## After-post follow-up

24-48 hours after posting, reply to the top comment (by upvotes) with:

> Update: X people tried it, Y filed issues, all fixed in [link to release]. Thanks for the feedback — the honest-weakness section got longer as a result.

Only post this if it's true. r/LocalLLaMA can smell fake updates from orbit.

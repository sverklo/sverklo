# Show HN draft — v0.2.16 launch

## Title (pick ONE, A/B internally if you have time)

**Primary:**
> Show HN: Sverklo – Local-first code intelligence for Claude Code and Cursor

**Alternate (more friction-focused):**
> Show HN: Sverklo – Stop re-explaining your codebase to your AI

**Alternate (more technical):**
> Show HN: Sverklo – Hybrid BM25+vector code search with PageRank, MIT, runs locally

**Do NOT use:**
- Anything with "the fastest" / "the best" / "finally" — invites challenge
- "I made" at the start — burns word budget, every Show HN is "I made"
- An em dash in the title — some HN users reflexively dismiss LLM-written copy on sight

## URL field

`https://github.com/sverklo/sverklo`

## Body (the first comment — HN convention)

Hi HN — I built Sverklo because every MCP code-search tool I tried either shipped my codebase to a vendor's cloud index or hallucinated file paths that didn't exist.

Sverklo is a local-first code intelligence MCP server. It runs entirely on your machine, indexes a repo in a couple seconds, and exposes semantic search, symbol-level impact analysis, diff-aware PR review, and persistent memory to Claude Code, Cursor, Windsurf, and Google Antigravity. MIT licensed, zero telemetry by default, no API keys, no cloud calls beyond the one-time 90MB embedding model download.

What it actually does well:

- **Hybrid search** — BM25 (lexical) + ONNX all-MiniLM-L6-v2 embeddings (semantic) + PageRank over the dependency graph (structural importance), fused with Reciprocal Rank Fusion. The three signals catch different failure modes than any one alone.
- **Impact analysis** — walk the symbol graph and return ranked transitive callers before you rename something billing-critical. Sub-millisecond on every repo I've tested because it's an indexed SQL join, not a string scan.
- **Diff-aware review** — risk score per file in a PR based on touched-symbol importance × test coverage × historical churn. Includes a structural heuristic that flags new calls introduced inside stream pipelines (`.map`, `.forEach`) when the enclosing method has no try-catch — the kind of latent outage pattern grep can't catch.
- **Bi-temporal memory** — decisions stored against the git SHA they were made at. The tool tells you if a memory you're recalling is about code that has since moved.

I benchmarked it on three real public repos, not toy projects. Numbers are reproducible with one command (`npm run bench` clones the pinned refs and runs the full profiler):

| Repo | Files | Cold index | Search p95 | Impact analysis |
|---|---:|---:|---:|---:|
| gin-gonic/gin | 99 | 10s | 12ms | 0.75ms |
| nestjs/nest | 1,709 | 22s | 14ms | 0.88ms |
| facebook/react | 4,368 | 152s | 26ms | 1.18ms |

Full methodology and the reproducer script are at https://github.com/sverklo/sverklo/blob/main/BENCHMARKS.md — including the on-disk format breakdown at docs/index-format.md.

**Where it's worse than the alternatives, because that's probably the more useful section:**

- **Exact string matching** — if you already know the literal symbol you're looking for, `ripgrep` is faster and more reliable. Sverklo shines when you don't know what to search for, not when you do.
- **Single-file edits** — for a focused signature change in one file, `git diff` + `Read` is hard to beat. Sverklo's value is cross-file and graph-level.
- **Small codebases (under ~50 files)** — the indexing overhead doesn't pay off below that. Just read everything. Sverklo starts earning its keep around 100+ files and really shines above 500.
- **Framework wiring questions** — "how is this bean registered" style queries get poor semantic matches because the answer lives in an annotation or a build-generated class, not in code that names the concept. The tool detects this query shape and explicitly recommends `Grep` for the annotation instead.

Try it on your own repo:

```
npm install -g sverklo
cd your-project && sverklo init
```

That's it. `sverklo init` auto-detects your installed AI coding agents, writes the right MCP config files, appends sverklo instructions to your CLAUDE.md, and runs `sverklo doctor` to verify the setup. Safe to re-run.

A few things I'm deliberately not claiming:
- Not replacing ctags, grep, or your LSP. Sverklo is complementary — the README explicitly tells you when to reach for each.
- Not the fastest at anything individually. The win is in the fusion and the memory layer.
- Not tested on every codebase. I've used it on my own repos for a few weeks and run a structured 3-session dogfood protocol on the tool itself (the log is at DOGFOOD.md — session #1 found four real bugs, all fixed before this post).

Happy to answer anything about the architecture, the tradeoffs, the embedding choice, the "why not tree-sitter" question, the memory model, the telemetry (it's opt-in by design), or anything else.

---

## Notes for reply camping

**Anticipated top questions + pre-drafted replies**

### "Why not just use Cursor's @codebase / Sourcegraph Cody?"

Different tradeoff. Cursor and Cody index in their clouds — for some users that's fine, for others (air-gapped, compliance-heavy, or just "I don't want my code indexed by a third party") it's a non-starter. Sverklo is for the second group. If you can use Cursor's @codebase and it works for you, it's a great product. Sverklo is an alternative, not a replacement.

### "Why not tree-sitter?"

The parser is currently regex-based across 18 languages because that's what shipped on day 1 of the project and regex parsing means zero native dependencies on install. Tree-sitter is on the roadmap for v0.3 — the regex parser has known edge cases (I just fixed a big one in v0.2.15 where the TS/JS parser was only indexing the first top-level function in a file), and tree-sitter will eliminate an entire class of those bugs. The fact that the fix was one line in a regex parser is also the argument against rushing the tree-sitter upgrade before we have real usage data telling us which edge cases matter most.

### "Why MiniLM-L6 and not something bigger?"

It's the Pareto choice: 384 dims, 90MB, fast enough to embed a React monorepo in a few minutes, accurate enough for hybrid retrieval where BM25 picks up exact-match signal. Pluggable in v0.2.14 — you can set `SVERKLO_EMBEDDING_PROVIDER=openai` or `ollama` and bring your own embeddings if you already have a similarity space. Voyage AI and Cohere providers are additive on the same interface and will ship in a follow-up.

### "How is this different from [N-th MCP code search tool]?"

Three things: (1) the four tool categories are in one server — search, impact, review, memory — instead of four separate MCPs; (2) the PageRank signal actually answers "which files matter" instead of "which files match"; (3) the memory layer is bi-temporal and tied to git SHAs, so your saved decisions age correctly. I'm probably wrong about how unique each of these is individually, but I don't know any single tool that combines all three.

### "Have you benchmarked against N?"

Probably not N specifically. I benchmarked against `ripgrep` (the grep gold standard), `git grep`, and `Cursor's built-in @codebase` on the same queries. Happy to run sverklo against any specific tool you name if you'd like to see the numbers — I'll reply with a GitHub issue.

### "Is the telemetry really opt-in?"

Yes, by design. `sverklo telemetry status` shows the current state (off by default). If you opt in, 9 non-identifying fields are sent per event: install ID (random UUID), version, OS, Node major, event type, tool name, outcome, duration ms, timestamp. No code, no queries, no file paths, no symbol names, no memory contents, no git state, no hostname, no IP. Every event is mirrored to `~/.sverklo/telemetry.log` before the network call so you can `tail -f` it. Full schema at https://github.com/sverklo/sverklo/blob/main/TELEMETRY.md.

### "How long did this take to build?"

~8 weeks of evenings and weekends for the core. The last week of focused work was driven by a structured dogfood protocol where I used sverklo on sverklo's own codebase, found four tool-level bugs, fixed them, then ran the protocol again to verify. Full log at `DOGFOOD.md` in the repo.

### "I found a bug"

Please file it at https://github.com/sverklo/sverklo/issues — I triage within hours during launch week. I'll ship a patch release for any real bug within 24 hours. You can check the track record: the 16 issues filed before launch are all closed, and there are 127 tests across 19 files covering every regression.

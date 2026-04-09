# r/ClaudeAI launch post

## Title (pick ONE)

**Primary (use-case framing):**
> Made Claude Code actually understand my codebase — local MCP server with symbol graph + memory tied to git

**Alternate (problem-first):**
> Stop re-explaining your project to Claude Code every session — local MCP server that remembers decisions per-git-SHA

**Alternate (curious):**
> Sverklo — an MCP server that gave Claude Code a real mental model of my repo (local, free, MIT)

**Do NOT use:**
- "Show HN" phrasing — wrong subreddit convention
- Tool-first titles ("Introducing X") — r/ClaudeAI rewards use-case framing
- "ChatGPT" in the title even as comparison — gets flagged

## Flair

`MCP` if available, otherwise `Tools` or `Show and tell`.

## Body

I've been frustrated that Claude Code either doesn't know what's in my repo (so every session starts with re-explaining the architecture) or guesses wrong about which files matter. Cursor's @codebase kind of solves it but requires uploading to their cloud, which is a no-go for some of my client work.

So I built **Sverklo** — a local-first MCP server that gives Claude Code (and Cursor, Windsurf, Antigravity) the same mental model of my repo that a senior engineer has. Runs entirely on my laptop. MIT licensed. No API keys. No cloud.

## What it actually does in a real session

**Before sverklo:** I ask Claude Code "where is auth handled?" It guesses based on file names, opens the wrong file, reads 500 lines, guesses again, eventually finds it.

**After sverklo:** Same question. Claude Code calls `sverklo_search("authentication flow")` and gets the top 5 files ranked by PageRank — middleware, JWT verifier, session store, login route, logout route. In one tool call. With file paths and line numbers.

**Refactor scenario:** I want to rename a method on a billing class. Claude Code calls `sverklo_impact("BillingAccount.charge")` and gets the 14 real callers ranked by depth, across the whole codebase. No grep noise from `recharge`, `discharge`, or a `Battery.charge` test fixture. The rename becomes mechanical.

**PR review scenario:** I paste a git diff. Claude Code calls `sverklo_review_diff` and gets a risk-scored review order — highest-impact files first, production files with no test changes flagged, structural warnings for patterns like "new call inside a stream pipeline with no try-catch" (the kind of latent outage grep can't catch).

**Memory scenario:** I tell Claude Code "we decided to use Postgres advisory locks instead of Redis for cross-worker mutexes." It calls `sverklo_remember` and the decision is saved against the current git SHA. Three weeks later when I ask "wait, what did we decide about mutexes?", Claude Code calls `sverklo_recall` and gets the decision back — including a flag if the relevant code has moved since.

## Screenshot

[SCREENSHOT: Claude Code window showing a sverklo_impact call on a method rename, with the tool output in the sidebar and Claude's response synthesizing the blast radius into a renaming checklist.]

[Alt: Second screenshot of `sverklo doctor` output showing the clean setup on a fresh project — version check, ONNX model, .mcp.json, MCP handshake response, CLAUDE.md integration.]

## The 20 tools in one MCP server

Grouped by job:

- **Search**: `sverklo_search`, `sverklo_overview`, `sverklo_lookup`, `sverklo_context`, `sverklo_ast_grep`
- **Refactor safety**: `sverklo_impact`, `sverklo_refs`, `sverklo_deps`, `sverklo_audit`
- **Diff-aware review**: `sverklo_review_diff`, `sverklo_test_map`, `sverklo_diff_search`
- **Memory** (bi-temporal, tied to git SHAs): `sverklo_remember`, `sverklo_recall`, `sverklo_memories`, `sverklo_forget`, `sverklo_promote`, `sverklo_demote`
- **Index health**: `sverklo_status`, `sverklo_wakeup`

All 20 run locally. Zero cloud calls after the one-time 90MB embedding model download on first run.

## Install (30 seconds)

```
npm install -g sverklo
cd your-project && sverklo init
```

`sverklo init` auto-detects Claude Code / Cursor / Windsurf / Google Antigravity, writes the right MCP config file for each, appends sverklo instructions to your `CLAUDE.md`, and runs `sverklo doctor` to verify the setup. Safe to re-run on existing projects.

## Before you install

A few honest things:

- **Not magic.** The README has a "when to use grep instead" section. Small repos (<50 files), exact string lookups, and single-file edits are all cases where the built-in tools are fine or better.
- **Privacy is a side effect, not the pitch.** The pitch is the mental model. Local-first happens to come with it because running a symbol graph on your laptop is trivially cheap.
- **It's v0.2.16.** Pre-1.0. I ran a structured 3-session dogfood protocol on my own tool before shipping this version — the log is public ([DOGFOOD.md](https://github.com/sverklo/sverklo/blob/main/DOGFOOD.md)) including the four bugs I found in my own tool and fixed. I'll ship patch releases for any real bugs within 24 hours during launch week.

## Links

- **Repo**: [github.com/sverklo/sverklo](https://github.com/sverklo/sverklo)
- **Docs**: [sverklo.com](https://sverklo.com)
- **Playground** (see real tool output on gin / nestjs / react without installing): [sverklo.com/playground](https://sverklo.com/playground)
- **Benchmarks** (reproducible with `npm run bench`): [BENCHMARKS.md](https://github.com/sverklo/sverklo/blob/main/BENCHMARKS.md)

If you try it, please tell me what breaks. I'll respond within hours during launch week and ship fixes fast.

---

## Reply-camping notes

r/ClaudeAI is enthusiast-heavy and appreciates use-case framing over architecture.

**Expected questions:**

- **"Does this work with Claude Desktop / the web app?"** — No, only with Claude Code (the CLI and the VSCode extension). Claude Desktop and the web app don't support MCP yet as far as I know. If Anthropic ships MCP for Claude Desktop, sverklo will work with it automatically — it speaks standard MCP over stdio.
- **"How is this different from the built-in Claude Code tools?"** — Complementary. The built-in tools (Read, Grep, Bash) are great for exact string work. Sverklo adds the graph-level layer: "which files matter," "who calls this symbol," "what's the blast radius of this change." See the README's "when to use grep" section.
- **"Claude Code already has @ and # — why do I need another tool?"** — `@` is file-level context injection. Sverklo is graph-level intelligence. Different granularity. You use both.
- **"Setup is complicated"** — It shouldn't be. `sverklo init` writes the MCP config for you. If it's not working, run `sverklo doctor` and paste the output — I'll help debug.
- **"How much RAM / disk?"** — Steady-state ~200 MB RAM after indexing finishes. Disk: ~15 KB per source file in the index. A 5k-file monorepo lands around 70 MB; React (4,368 files) is 67 MB.
- **"Does this log my queries?"** — Only to your local `~/.sverklo/telemetry.log` if you opt in to telemetry, and only the event type + duration — never the query text, file paths, or symbol names. Off by default. Full schema at [TELEMETRY.md](https://github.com/sverklo/sverklo/blob/main/TELEMETRY.md).

**Do NOT say:**

- "Claude Code needs this" — users who love Claude Code don't want to be told it's incomplete
- "Cursor and Windsurf already have this built in" — even if partly true, it invites comparisons you don't want to be the one making
- "Upvote if you found this useful" — transparent, downvoted

## After-post

If the post gets traction (>100 upvotes), reply with a follow-up comment ~4 hours later:

> Update: X installs since the post, Y GitHub issues filed, all triaged. Most common question: "how do I make sure Claude actually reaches for sverklo tools over Grep?" Answer: `sverklo init` appends a section to your CLAUDE.md instructing the agent to prefer sverklo for semantic queries. If it's not there, re-run `sverklo init` — it's idempotent.

Only post this if it's true and the question is actually being asked.

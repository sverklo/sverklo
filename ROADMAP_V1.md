# Roadmap to v1.0

What's left after the 2026-04 8-agent review (Team Alpha due-diligence + Team Bravo competitor teardown). The bug-fixes and quick wins shipped in the same session as the review; this file tracks the bigger work that needs more than one sitting.

Items are ordered by **leverage × confidence**: things that ship moats with high confidence first, things that depend on outside resources or design partners last.

---

## v0.16.0 — already in the bag

The release-blocking P0s and P1s from the 8-agent review are all fixed in the working tree as of this commit:

- Destructive `--help` paths neutralised across all 21 subcommands; `register` now rejects flag-shaped positionals.
- `sverklo_ast_grep` containment-check (no more confused-deputy reads of `~/.aws` etc).
- HTTP dashboard binds `127.0.0.1` explicitly.
- Dashboard `kind` filter chips hide when their bucket is empty; v8 migration backfills `kind` from `category`.
- PageRank applies a built-in `0.1×` weight to non-code (`.md`, `.yaml`, `.json`, `.toml`, …) so audit no longer grades a no-deps repo "A — no dependencies tracked."
- `fonts.googleapis.com` removed from the dashboard. `@font-face local()` falls back to system stack — zero beacons.
- `memoryEmbeddingStore.findTopK` + `getMany` replace unbounded `getAll()` in `recall`/`remember`/`prune` — constant-memory in K rather than linear in row count.
- README hero rewritten to "Stop your AI from making things up about your codebase."
- `/vs/greptile` and `/vs/claude-context` comparison pages live on sverklo-site.
- AEO README sections quoting buyer queries verbatim.
- Three previously-unsold moats (filename-as-signal retrieval, channelized RRF, bi-temporal `superseded_by` lineage) get a named README section each.
- `init` post-output leads with `sverklo audit-prompt | claude` — the highest-leverage demo line, previously buried.
- 5 weakest tool descriptions rewritten with explicit "use this *instead of X* when…" pivots.

Tag and ship `v0.16.0`. The commit message is in `git log` already.

---

## v0.17 — credibility (4–6 weeks)

Goal: the bench score nobody can dispute.

### 1. Cross-repo public eval (`bench:swe`)

The competitor teardown identified this as the single most defensible piece of work — *and* the longest path to clone. Today `npm run bench:research` runs 32 hand-written questions against sverklo's own repo, with synonyms in `src/search/synonyms.ts` tuned to pass them. Any reproducible third-party leaderboard kills the "99% recall" claim instantly.

**Plan:**
- Scrape ~500 questions from real GitHub PRs across 20 OSS repos (express, nestjs, react, vite, prisma, hono, gin, axum, …). Ground truth = files-touched-by-the-fix from `git log --name-only`.
- One question per PR, phrased as "where would I look to fix \<bug X\>" or "what does \<feature Y\> currently do."
- Run sverklo + four competitors (Cursor's @codebase via API where exposed, claude-context, codebase-memory-mcp, GitHub's MCP) on the same dataset, publish the leaderboard at `sverklo.com/bench`.
- Provide a 50-line reproducer script alongside the dataset so reviewers can re-run.

**Why:** sverklo's bench credibility today rests on its own questions. A public cross-repo leaderboard either confirms us or surfaces what to fix. Either outcome is better than the current ambiguity.

### 2. Tree-sitter parser

`src/indexer/parser.ts` is 1,295 lines of regex parsers with a "tree-sitter upgrade path for v2" comment in line 6. The competitor teardown explicitly named this: "side-by-side of the same Express file with sverklo missing 4 chunks our parser catches" was their day-1 marketing weapon.

**Plan:**
- Add `web-tree-sitter` as a dependency. WASM grammars for top 7 languages (TS, JS, Python, Go, Rust, Java, Ruby) — ~2 MB total, bundled in `dist/`.
- Wire a new `src/indexer/parser-tree-sitter.ts`; gate it behind `SVERKLO_PARSER=tree-sitter` env until parity confirmed.
- Run the full `bench:research` and the new cross-repo eval at parity; promote tree-sitter as the default once recall holds.
- Keep regex as the fallback for unsupported languages.

**Why:** the parser is the most-clonable piece of the codebase if a competitor wants to attack on parser correctness. Closing this neutralises the attack and lifts recall on edge cases (CommonJS prototype methods, generators, decorated classes, …).

---

## v0.18 — visibility (3–4 weeks)

Goal: stop being "a great engine wearing no clothes."

### 3. PR-bot inline review

Sverklo today posts a single sticky comment via `action/action.yml`. Greptile's mid-market wedge is per-line review on every PR — a competitor that ships this surface owns the *visible artifact* even when sverklo has the better engine.

**Plan:**
- Add `sverklo review --format github-suggestions` that emits per-line `suggestion:` blocks anchored to the diff lines flagged by `sverklo_review_diff`.
- Update `action/action.yml` to post inline review comments via the PR Review API alongside the existing sticky summary comment.
- Add a `--auto-approve-low` flag for PRs scoring `risk: low`.

### 4. Editor-inline blast radius (VS Code + Cursor)

The 6-second demo Bravo-2 named: highlight `useAuth` in Cursor → editor margin lights up with `47 callers, 8 in production, 2 untested`. Type a breaking change → margin turns red on every caller.

**Plan:**
- Ship a thin VS Code extension (`sverklo-vscode`) that connects to the local sverklo MCP server and renders inline decorations on the active editor.
- Decorations: caller count, untested-callers count, "you'd break:" hover. No new engine — pure UI on top of `sverklo_impact` and `sverklo_test_map`.
- Same shape works for Cursor (forks VS Code) and Windsurf without changes.

### 5. `sverklo digest` morning ritual

Habit loop: 5-line markdown summary printed when the user `cd`s into the repo (via shell hook) or pushed to a configured Slack/Discord/email channel.

**Plan:**
- New `sverklo digest --since 7d` CLI command.
- Output: yesterday's high-risk symbols touched, memories that went stale (related-files changed under the SHA), new dead-code candidates, audit-grade delta.
- Optional `--post slack://#channel` and `--post email://you@addr` outputs for team-wide adoption.

---

## v0.19 — team layer (5–6 weeks)

Goal: stop being a single-user, single-machine, single-repo journal.

### 6. Cross-repo workspace memory

Today `sverklo_remember` writes to `~/.sverklo/<project-hash>/index.db`. A team with 14 services has 14 disconnected memory files.

**Plan:**
- Workspace-shared memory database at `~/.sverklo/workspaces/<workspace-name>/memories.db`. Already-implemented `sverklo workspace` command points at it.
- Per-memory `scope: 'project' | 'workspace'` field. `sverklo_remember scope:workspace` writes there.
- `sverklo_recall` with no project bias falls back to workspace-level matches when a project search comes up empty.

### 7. Memory exporter to Notion / Linear / Confluence

The "we should write that down" loop today ends in sverklo's local SQLite. Most teams keep their decision log in Notion or Confluence. Build the bridge.

**Plan:**
- `sverklo memory export --format notion --to <database-id> --token $NOTION_TOKEN` writes a Notion page per `kind:semantic` memory, grouped by `category`.
- Same shape for Linear (issues), Confluence (pages), and Markdown directory dump.

---

## v0.20 — eval surface (3 weeks)

### 8. The bench dashboard

Once `bench:swe` exists, every commit can produce a per-task delta against the previous commit. CI fails if a PR drops a previously-perfect task. Public-facing graph at `sverklo.com/bench` showing recall over time.

---

## Logo + brand

Track this in `BRAND.md` (created in this session). The keystone item — replacing `docs/logo.png` with a `▌sverklo` mono wordmark — is design work, not engineering. Two paths:

1. **DIY:** any designer with JetBrains Mono Bold and 30 minutes can draw the wordmark. SVG export at `docs/logo.svg`, regenerate the PNG variants from there.
2. **External:** brief a designer with `BRAND.md` (it has the full spec). Budget: 1 day.

---

## Items explicitly *not* on this roadmap

The 8-agent review surfaced ideas that look attractive but violate sverklo's constraints. Recording here so future research cycles short-circuit:

- **Hosted SaaS or "sverklo cloud."** Sverklo's defensibility is local-first. The day we ship a cloud, we are competing with Greptile and Sourcegraph on their terms. No.
- **LLM in the hot retrieval path.** The agent calls our tools; we do not call an LLM to answer. (Offline LLM passes — `concept-index`, `enrich-symbols`, `prune --with-ollama` — are fine because they're opt-in CLI commands.)
- **Mascot.** Engineers don't trust mascots in dev infra. The graph and the wordmark are the brand.
- **Rebrand.** "Sverklo" survives the audit because the .com / npm / GitHub handles are clean. We make the drill metaphor load-bearing in copy instead of starting over.

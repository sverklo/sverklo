# Changelog

All notable changes to sverklo are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions before 0.16.0 don't have entries here yet — see `git log` for history.

---

## [0.17.1] — 2026-04-26

Republish of v0.17.0 — same payload, lockfile re-synced for the
`web-tree-sitter` optionalDependency I forgot to install before
tagging. CI's `npm ci` step rejects out-of-sync lockfiles, so v0.17.0
never reached the npm registry.

---

## [0.17.0] — 2026-04-26 (skipped)

Tagged but never published — CI rejected the lockfile drift. Replaced by 0.17.1.

The "v0.17 prep" release. Thirteen scaffolds, prototypes, and
infrastructure pieces from `ROADMAP_V1.md` land as working code, all
opt-in / additive on top of v0.16.0. None of these are user-visible by
default — they are the foundation for v0.18's "credibility weapon"
(cross-repo eval) and "tree-sitter default flip" work.

### Added

- **`bench:swe` cross-repo evaluation** — `npm run bench:swe` clones 5
  pinned OSS repos (express, nestjs, vite, prisma, fastapi) into
  `benchmark/.cache/swe/` and runs a per-repo recall eval. 65 seed
  questions; aggregated results report. Reproducible by anyone with
  `git clone` access; PRs that add questions are explicitly welcome.
  This is the third-party-reproducible eval the v0.16 competitor
  teardown named as the only thing that actually takes weeks to clone.
- **Tree-sitter parser opt-in** — set `SVERKLO_PARSER=tree-sitter` and
  the indexer routes through `parseFileAsync()` → tree-sitter for any
  file whose grammar is installed at `~/.sverklo/grammars/`. Silent
  fallback to the regex parser when grammars are missing or
  `web-tree-sitter` (now an `optionalDependency`) isn't available. Six
  languages wired: TypeScript, TSX, JavaScript, Python, Go, Rust.
  Parity script at `scripts/parity-check.mjs` produces a reproducible
  before-flip baseline (71% Jaccard on sverklo's own TS files,
  tree-sitter +103 net named symbols).
- **`sverklo grammars install`** — fetches WASM grammars from
  jsdelivr (~3.5 MB total across 6 languages), validates the WASM
  magic header, caches at `~/.sverklo/grammars/`. `--force`
  re-downloads. `sverklo grammars list` shows what's installed.
- **`sverklo memory export`** — exports the memory store to
  markdown (one .md per category), Notion (ND-JSON of API page-create
  payloads ready to pipe into your own integration), or raw JSON.
  `--kind episodic|semantic|procedural` filter,
  `--include-invalidated` for the bi-temporal timeline. Closes the
  "memory is a private journal" gap from the v0.16 product teardown.
- **`sverklo workspace memory <name> {add|list|search|forget}`** —
  per-workspace shared memory at
  `~/.sverklo/workspaces/<name>/memories.db` (same schema as project
  memory, reusing `MemoryStore` + `MemoryEmbeddingStore`).
- **`sverklo_remember scope:"workspace"`** — saves to the workspace
  memory store the project belongs to (auto-detected from
  `findWorkspaceForPath()`). Embeds for future vector recall. Errors
  cleanly when the project isn't part of any registered workspace.
- **`sverklo_recall` cross-store blend** — when the project belongs
  to a workspace, recall pulls up to 5 high-FTS-rank workspace
  memories alongside project results, marked with a `[ws]` badge so
  the agent knows where each answer came from.
- **`sverklo_review --format github-review-json`** — emits a
  structured payload that the GitHub Action hands to
  `pulls.createReview` to post inline review comments anchored to the
  specific lines our heuristics flagged (alongside the existing sticky
  summary comment). The action's new `inline-comments: true|false`
  input toggles between the v0.15 sticky-only behaviour and the new
  inline-plus-sticky default. Closes the human-visible-surface gap
  vs Greptile that the v0.16 competitor teardown named as sverklo's
  biggest product hole.
- **VS Code extension scaffold** — `extensions/vscode/` package with
  a working extension that decorates function/class headers in the
  active editor with caller counts via `sverklo refs`. Pre-built
  `sverklo-vscode-0.1.0.vsix` (6.97 KB) ships in-tree:
  `code --install-extension extensions/vscode/sverklo-vscode-0.1.0.vsix`.
  Settings: `sverklo.binary`, `decorations.enabled`,
  `decorations.minCallers`. Marketplace publish workflow
  (`.github/workflows/publish-vsix.yml`) is dormant until the user
  creates a publisher account + adds the `VSCE_PAT` secret.
- **`sverklo digest [--since 7d]`** — 5-line summary of what changed
  in the project since the window started (audit-grade trend, new
  vs stale memories, high-PageRank files touched, scope counts).
  Designed for shell-hook on `cd` into the repo or wired into a
  Slack/email post. The morning-ritual habit loop from
  `ROADMAP_V1.md`.
- **`docs/parser-parity.md`** — captures the v0.17 baseline + the
  v0.18 default-flip plan: keep `extractFileHeader` running on top
  of tree-sitter, validate `bench:research` and `bench:swe` stay at
  parity, then flip.

### Changed

- **Logo SVG glyph→paths** — `docs/logomark.svg` replaces
  `<text>s</text>` with a vector `<path>` traced from JetBrains Mono
  Bold via opentype.js. ImageMagick / rsvg-convert / Inkscape now
  render pixel-identical without the font installed. `logo.svg`
  / `logo-light.svg` keep `<text>` because they only render in
  browsers with `@font-face local()` already in place.

### Internal

- `scripts/parity-check.mjs` — reproducible parser parity reporter.
- `extensions/vscode/.vscodeignore` + `LICENSE.md` ensure the .vsix
  packs cleanly.
- `web-tree-sitter` is an `optionalDependency` so npm install never
  fails if a user can't compile the WASM toolchain.

### Notes

309/309 tests pass. `bench:research` stays at **99.0%** recall (31/32)
across all changes — deterministic across runs. The single missed
task is the same `sverklo-evidence-verify` 2-of-3 boundary case
tracked since v0.16. Schema version unchanged (still 8) — every
v0.17 addition is layered on top of the existing storage.

The marketplace publish workflow + the bench:swe corpus expansion to
500 questions are the main v0.18 follow-ups that need external
action (Microsoft publisher account, sustained dataset curation).

---

## [0.16.0] — 2026-04-25

The "v0.16 perfect-product" release. Sprint 9 features land in user-visible form, an 8-agent due-diligence + competitor-teardown review closes every flagged P0 / P1, the brand identity is unified, and a v1.0 roadmap is on the record.

### Added

- **`sverklo prune` CLI** — access-decay scoring + episodic-memory consolidation. Bi-temporal `superseded_by` lineage preserved (originals never deleted). Optional `--with-ollama` for distilled summaries with up-front reach-check. `--help` prints flag docs; `--max-age-days`/`--similarity-threshold`/`--min-cluster-size`/`--stale-threshold` are validated for sane ranges.
- **`sverklo_overview depth: 1|2|3|4`** — progressive disclosure outline (iwe-org/iwe `squash`/`tree` pattern). depth=1 returns directories only (~470 chars on the sverklo repo), depth=4 returns every named export (~10 k chars). Same wall-time at every depth; the saving is in payload tokens.
- **`sverklo_search mode: "refs" | "full"`** — refs mode returns hits without bodies (file:line + score + name). Same latency as full mode, ~half the payload tokens.
- **`memories.kind` (`episodic | semantic | procedural`)** — orthogonal to `tier`. `sverklo_remember kind:semantic` is honoured, `sverklo_recall kind:procedural` filters. Schema bumped to v8 with one-time category→kind backfill so dashboard chips render correctly on upgraded databases.
- **`doc_mentions.edge_kind` (`includes | references`)** — iwe inclusion-vs-reference split. `sverklo_refs` now splits doc mentions into "this section documents the symbol" vs "this section just mentions it" buckets and dedups outer/inner chunk pairs at render time.
- **README "Three retrieval techniques you'll only find here"** — names the previously-unsold moats: filename-as-signal retrieval, channelized RRF fusion, bi-temporal `superseded_by` lineage.
- **`/vs/greptile` and `/vs/claude-context`** comparison pages on sverklo-site, with FAQ JSON-LD for AEO.
- **Common-questions section in README** quoting buyer queries verbatim ("How do I stop Claude Code from hallucinating about my codebase?", "Is there a local-first MCP server for codebase memory?", "Is there an open-source alternative to Sourcegraph Cody I can run locally?").
- **`BRAND.md`** — v1.0 brand spec a designer or contributor can hand-execute. Wordmark, palette, type, voice, hero copy, anti-patterns.
- **`ROADMAP_V1.md`** — v0.17 → v0.20 plan covering the work that doesn't fit one session: cross-repo eval, tree-sitter parser, PR-bot inline review, editor-inline blast radius, `sverklo digest`, workspace memory.
- **New brand assets:** `docs/logo.svg`, `docs/logo-light.svg`, `docs/logomark.svg`. Rendered PNG variants replace `docs/logo.png` (was an iOS-app-icon, now a flat-fill mono mark). Site favicon, apple-touch-icon, og.png/og.svg all rebuilt.
- **`sverklo prune` regression tests** + **v7→v8 migration test**.
- **Shared `_validation.ts`** for tool handlers; `validateEnum` and `requireString` give consistent errors across `search`, `remember`, `recall`.

### Changed

- **Hero rewritten.** README and sverklo.com now lead with "Stop your AI from making things up about your codebase." The previous "code intelligence for AI agents" h1 was a category label, not a buyer outcome.
- **`sverklo init` post-output now leads with `sverklo audit-prompt | claude`** — the most differentiated artifact in the product, previously buried under "Restart Claude Code."
- **5 weakest tool descriptions rewritten** (`forget`, `audit`, `ast_grep`, `wakeup`, `clusters`) with explicit "use this *instead of X* when…" pivots.
- **PageRank applies a built-in 0.1× weight** to non-code files (`.md`, `.yaml`, `.json`, `.toml`, …) so audit no longer grades a no-deps repo "A — no dependencies tracked." User config can still override.
- **`memoryEmbeddingStore.findTopK` (streaming heap) + `getMany` (batched)** replace unbounded `getAll()` in `recall`/`remember`/`prune`. Memory consumption is now constant in K rather than linear in row count.
- **Dashboard memories view** gains a `kind` filter (chips hide when their bucket is empty), surfaces `kind` per row.
- **`find-references` doc mentions** are deduplicated by `(file, breadcrumb, match_kind)` so nested fenced-code chunks don't produce off-by-one duplicate rows.
- **README tool count fixed** from "23 tools" to "37 tools" everywhere.

### Fixed

- **Destructive `--help` paths neutralised across all 21 subcommands.** Previously `sverklo wiki --help` wrote 61 markdown files into the user's repo; `sverklo init --help` rewrote `~/.gemini/antigravity/mcp_config.json`; `sverklo register --help` registered the literal string "--help" as a repo at `/private/tmp/--help`. A global interceptor now prints per-subcommand help text and exits before any destructive setup runs.
- **`sverklo_ast_grep` containment check** — paths outside `indexer.rootPath` are rejected. Closes a confused-deputy primitive that let an agent prompt read `/etc`, `~/.aws`, or sibling repos.
- **HTTP dashboard binds `127.0.0.1` explicitly** (was `0.0.0.0` implicit). `/api/files` no longer reachable from same-Wi-Fi devices.
- **Prune Ollama prompt-injection sanitisation** — cluster member content is wrapped in delimited `<memory id="N">…</memory>` blocks with closing-tag stripping and a 1500-char clamp; system prompt instructs the model to ignore instructions inside the blocks.
- **Prune defaults bug** — `{...DEFAULTS, ...opts}` allowed CLI `undefined` (when a flag is absent) to overwrite the default and silently make the entire prune a no-op. Now field-by-field `??` merge with regression test.
- **Prune transactional consolidation** — per-cluster insert + embed + invalidate writes wrapped in `db.transaction()` so a crash mid-cluster can't leave a zombie consolidated row alongside un-invalidated originals.
- **CLI numeric flags validated** — `sverklo prune --max-age-days abc` now exits 2 with a clear error instead of silently using defaults.
- **Subcommands accept positional path** — `audit`, `review`, `wiki`, `prune`, `concept-index`, `enrich-symbols`, `enrich-patterns` now honour the first positional arg as the project directory and reject nonexistent paths with exit 2.
- **`sverklo_remember kind:"junk"` rejected** with a clear error (was silently accepted and stored an out-of-enum value).
- **`sverklo_search` and `sverklo_remember` return usage strings** for missing/wrong-typed required args (was leaking `Cannot read properties of undefined (reading 'toLowerCase')` from internals).
- **`sverklo init` no longer imports a `CLAUDE.md` it just created** — previously claimed "imported 17 memories" from its own boilerplate template.
- **`sverklo init` rewires Antigravity config** when the existing entry points at a different project (was silently keeping the stale entry).
- **Doctor recommends `npx sverklo`** when a local install is detected, instead of `npm install -g sverklo`.
- **Evidence table eviction.** `EvidenceStore.purge()` was only called once at indexer construction — long-running MCP sessions accumulated 41 k+ rows. Now amortised across every 256 inserts inside `insert()`. Closes the ~30 MB / 1k-search RSS growth observed in the perf review.
- **`memories.kind` and `doc_mentions.edge_kind` backfill** — SQLite's ADD COLUMN with DEFAULT doesn't always backfill existing rows; explicit `UPDATE … WHERE … IS NULL` runs after every ALTER so kind-filtered recall doesn't silently drop pre-migration rows.
- **`sverklo prune` reports truncation** when the 10 k scan cap kicks in (was silent; users with bigger memory stores saw `scanned: 10000` and didn't know about the rest).
- **CLI `register` rejects flag-shaped positionals** (e.g. `register --foo` no longer creates a repo named `--foo` at `/private/tmp/--foo`).
- **`sverklo --help` rewritten** — adds `audit`/`review`/`workspace`, disambiguates the two `setup` lines, groups commands by purpose.
- **`mode: "refs"` description rewritten** — now correctly describes "same latency, ~half the payload tokens" instead of the old "cheapest discovery step" claim.

### Security

- **Build script preserves +x bit on `dist/bin/sverklo.js`.** v0.15.0 shipped without execute permission, causing `fork/exec /opt/homebrew/bin/sverklo: permission denied` for global installs. `package.json` `build` script now runs `tsc && chmod +x dist/bin/sverklo.js` so `prepublishOnly` always ships an executable binary.

### Privacy

- **Dashboard no longer beacons fonts.googleapis.com.** `@font-face local()` declarations pick up installed JetBrains Mono / Public Sans, falling back to the system mono / sans stack. Sverklo makes zero network calls unless the user explicitly opts into telemetry.

### Brand

- New mono-wordmark logo replaces the iOS-app-icon style across README, npm card, GitHub social preview, browser tab, iOS home-screen save, and dashboard chrome. Visual identity is now coherent with the engineering-serious craft-OSS register the rest of the product already lived in.
- Site OG card rewritten with the new buyer-outcome hero.

### Notes

The `bench:research` benchmark stays at **99.0 % recall (31/32)** across all changes — deterministic across runs. The single missed task (`sverklo-evidence-verify` finds 2 of 3 evidence files) is a known boundary-case ranking issue tracked for v0.17.

Schema version bumped to 8. Migrations are additive and tested; existing v7 databases upgrade in place.


# Sverklo Public Launch Plan

Synthesis of work from 4 marketing agents (Growth Hacker · Content Creator · Reddit Community Builder · SEO Specialist) — 2026-04-07.

Goal: drive adoption with a high-quality, honest launch that compounds. Target launch day: **Tue 2026-04-21** (Show HN day).

Companion file: `LAUNCH_CONTENT.md` — every ready-to-publish draft (blog, HN, X, LinkedIn, Reddit, tutorials, demo script).

---

## TL;DR — what to do this week

1. **Set up Google Search Console + Bing Webmaster Tools** for sverklo.com (currently zero indexation — `site:sverklo.com` returns 0 results). Submit sitemap. P0.
2. **Fix homepage `<head>`**: title, meta description, OG tags, canonical, viewport, JSON-LD `SoftwareApplication` (templates in §SEO below). P0.
3. **Ship `robots.txt` + `sitemap.xml`** to Netlify. P0.
4. **Add GitHub Topics** to sverklo/sverklo: `mcp mcp-server model-context-protocol code-search semantic-search code-intelligence claude-code cursor local-first embeddings ast pagerank developer-tools ai-agents bm25 rag onnx`. P0, 5 min.
5. **Update `package.json`** with `keywords` array, `homepage`, `repository`, `bugs`. Publish a patch so npm refreshes. P0.
6. **Submit PRs to top 3 awesome-mcp-servers lists**: `wong2/awesome-mcp-servers`, `appcypher/awesome-mcp-servers`, `punkpeye/awesome-mcp-servers`. P0.
7. **Submit to MCP directories**: `mcp.so`, `pulsemcp.com`, `smithery.ai`, `glama.ai/mcp/servers`, `mcpcat.io`. P0.
8. **Record a 60s asciinema demo** and put it above the README fold. The single biggest README ROI. P0.
9. **Ship the top 10 README/landing-page fixes** below. P0/P1.
10. **Add opt-in privacy-preserving telemetry** so the activation funnel is measurable. Without it, every launch decision is a guess. **This is the W0 critical path eng task.**

---

## Pre-launch fixes — top 10 (Week 0: 2026-04-07 → 2026-04-12)

| # | Where | Problem | Fix |
|---|---|---|---|
| 1 | README hero | No proof artifact above the fold — no GIF, asciinema, or screenshot. | Add a 15-second asciinema cast: `sverklo init` → Claude Code calling `sverklo_impact` with risk-score output. Loop it. |
| 2 | README "What it does" table | Lists 10 tools, prose mentions 20. `sverklo_impact`, `sverklo_review_diff`, `sverklo_test_map`, `sverklo_audit`, `sverklo_context` missing from table. | Update to all 20 tools, group into 4 buckets: **Search · Impact · Review · Memory**. Buckets map to jobs. |
| 3 | Install flow | 4 steps + a branch (`which sverklo` for Cursor/etc). | Make `sverklo init` auto-detect Cursor/Windsurf/VSCode/Antigravity and write all configs in one shot. Ship `npx sverklo init` to skip the global install entirely. |
| 4 | Antigravity | Buries a real differentiator (newest agent supported) in a 200-word footnote about a Google bug. | Promote "Works with Claude Code, Cursor, Windsurf, VS Code, JetBrains, **and Antigravity**" to the hero. Move the global-config caveat into a collapsed `<details>`. |
| 5 | Honest positioning | "When you know what to search for, grep is fine" competes with the value prop in the same scroll. New users bounce. | Reframe as "When to reach for sverklo" with 3 concrete job-stories: "I'm renaming a public method", "I'm reviewing a 40-file PR", "I'm onboarding to a new repo". |
| 6 | Performance table | "Index 38 files: 640ms" — toy repo. Senior engineers will roll their eyes. | Run on 3 reference repos (react ~3k files, nestjs ~2k, a Go monorepo). Publish files / index time / cold search / warm search / RAM / DB size. Becomes a tweetable artifact. |
| 7 | "Why not…" comparison table | No links, no dates, missing real competitors. | Date-stamp ("as of 2026-04"), source links, add **Cursor's built-in indexer**, **Continue.dev**, **Claude Context (Zilliz)** — these are the actual mindshare competitors. |
| 8 | No social proof | No stars badge, no "used by", no testimonial, no Discord count. | Add shields.io badges (npm version, weekly downloads, GH stars, MIT, Discord). Add `TESTIMONIALS.md` with 3 beta-user quotes. Get them this week if you don't have them. |
| 9 | Pro/Team tease | "Coming soon" with no waitlist = wasted intent capture. | One-line Tally form → "Get notified when Team ships". Every star-gazer is a lead. |
| 10 | No "first 5 minutes" doc | README jumps install → tool table. No scripted path to a wow moment. | Add `FIRST_RUN.md` with three exact prompts to paste into Claude Code: (a) `sverklo_overview` this repo, (b) `sverklo_impact <symbol>`, (c) `sverklo_review_diff` on current branch. The wow moment must be **scripted**, not discovered. |

**Bonus product fixes (high-impact for activation):**
- **ONNX 90MB download has no progress bar.** First-run on flaky wifi = silent hang = uninstall. Add progress bar + resume + integrity hash + `--offline` flag for pre-downloaded model.
- **Agent doesn't know when to call sverklo.** The CLAUDE.md template `sverklo init` writes is too soft. Rewrite with explicit *trigger phrases*: "user mentions refactor → call sverklo_impact first", "user asks 'how does X work' → call sverklo_search before Read", "user asks for review → call sverklo_review_diff". Ship MCP prompts as `/sverklo:onboard`, `/sverklo:review` slash commands — 10× more discoverable than tool descriptions.

---

## Growth model

**North Star Metric: Weekly Active Indexed Repos (WAIR)** — distinct `(machine_id, project_hash)` pairs that issued ≥1 sverklo tool call in the last 7 days. Not installs, not stars. A repo only counts when an agent actually called sverklo on it that week.

**Leading indicators:**
1. **Activation rate** — % of new installs issuing ≥3 tool calls within 24h of `sverklo init`. Target: 60%+.
2. **Day-7 retention** — % of activated repos still active on day 7. Target: 40%+ (MCP servers either stick or get uninstalled fast).
3. **Tool diversity** — median distinct sverklo_* tools used per active repo per week. If everyone only uses `sverklo_search`, you're a grep alternative, not a code intelligence platform. Target: ≥4.
4. **Memory write rate** — % of active repos that ever call `sverklo_remember`. Stickiness moat: once memories exist, switching cost spikes. Target: 25%+.

**Activation funnel + drop-offs:**

```
Saw a tweet / HN post              100%
Clicked through to sverklo.com      35%   ← LP doesn't communicate value in 8s
Ran npm install                     12%   ← no demo video, no copy-button, no signup line
Ran sverklo init                     9%   ← 90MB ONNX download fails on flaky wifi
First sverklo_* tool call            6%   ← MCP doesn't appear in /mcp; doctor fix is buried
≥3 tool calls in 24h                 4%   ← agent doesn't know WHEN to call sverklo
Day-7 return                         2%   ← no aha moment, treated as "another search tool"
Memory write (sticky)                0.6%
Daily use                            0.4%
```

**Two biggest leaks:** tweet → install (fix with above-fold demo + copy-paste + "no API key" screamer) and install → activated (fix with auto-detect init and explicit trigger phrases in CLAUDE.md template).

---

## Channel scorecard

| # | Channel | ICP fit | CAC | Scalability | Defensibility | When |
|---|---|---|---|---|---|---|
| 1 | **awesome-mcp-servers PRs (GitHub)** | 5 | $0 | Compounding | High | W0 day 1 |
| 2 | **r/LocalLLaMA** | 5 | $0 | High | Medium | W1 |
| 3 | **r/ClaudeAI + r/cursor + r/mcp** | 5 | $0 | High | Medium | W1 |
| 4 | **Hacker News (Show HN)** | 5 | $0 | One-shot | Low | **W2 Tue 04-21 8am ET** |
| 5 | **Anthropic MCP directory + partnership** | 5 | $0 | Compounding | Very High | W0 (apply day 1) |
| 6 | **X dev community + reply-guy** | 4 | $0 | Medium | Low | Continuous |
| 7 | **Claude Code / Cursor / MCP Discords** | 5 | $0 | Low | Medium | W1, ongoing |
| 8 | **YouTube (Theo, Fireship-tier, Matt Pocock)** | 4 | Outreach time | Medium | Medium | W3-W4 |
| 9 | **Podcasts (Changelog, Software Unscripted, Latent Space)** | 4 | Time | Medium | High | W3+ outreach |
| 10 | **dev.to / Hashnode crossposts** | 3 | $0 | Low | Low | W2-W4 |
| 11 | **ProductHunt** | 2 | $0 | One-shot | Low | W4 (do not lead with it) |
| 12 | **Paid (Google "cursor indexing", X promoted)** | 2 | $$$$ | High | None | Skip until $ARR |

**Top 3 to lead with:**
1. **awesome-mcp PRs (W0 day 1)** — highest leverage zero-cost move; compounds forever.
2. **r/LocalLLaMA + r/ClaudeAI + r/mcp (W1)** — exact ICP, "local-first, no API key" *is* r/LocalLLaMA's identity.
3. **Show HN (W2 Tue 04-21 8am ET)** — one shot. Need ammo: working demo gif, polished README, ≥100 stars seeded from W1 Reddit, the first author comment pre-written (matters more than the title).

**Why not ProductHunt first:** PH audience is PMs and indie hackers, not senior eng ICP. Use it W4 for long-tail SEO.

---

## 30-day launch sequence

**Week 0 (04-07 → 04-12) — Ammunition**
- Ship the 10 README/LP fixes.
- Record asciinema + 60s demo video.
- Run 3-repo benchmark (react/nestjs/Go monorepo) → publish `BENCHMARKS.md`.
- Get 5 beta users to give one-line testimonials.
- Submit to Anthropic MCP directory (long lead).
- Open PRs to 4 awesome-mcp lists (don't merge yet — schedule for W1 Mon).
- Pre-write HN Show HN post and 5 Reddit variants (drafts in `LAUNCH_CONTENT.md`).
- **Set up opt-in telemetry** so NSM is measurable.
- **Reddit:** create the founder account, complete profile, start the 14-day lurk-and-comment plan immediately.

**Week 1 (04-13 → 04-19) — Soft launch + trust building**
- Mon 04-13: merge awesome-mcp PRs. Post in MCP / Claude Code Discord. Publish X value thread B ("I benchmarked 5 ways an AI agent searches code").
- Tue 04-14: deep-dive blog post #1 on RRF + PageRank (no CTA — earn HN regulars' trust pre-launch).
- Wed 04-15: r/LocalLLaMA launch post (morning PT).
- Thu 04-16: X value thread C ("Why semantic search alone is wrong for code"). r/mcp post.
- Fri 04-17: dev.to crosspost of the deep-dive. LinkedIn warm-up post.
- Goal end W1: 300 stars, 50 installs, ~20 activated repos, telemetry working.

**Week 2 (04-20 → 04-26) — HN one-shot**
- Mon 04-20: stress test. Make sure docs / Discord / GitHub issues can handle 10× load. Publish tutorial A blog post.
- **Tue 04-21 ~8:00 ET: Show HN.** Title: `Show HN: Sverklo – Local-first code intelligence MCP for Claude Code and Cursor`. Drop the pre-written first author comment immediately. Live in comments for 12 hours straight — comment velocity drives HN ranking.
- Tue 04-21 (later): launch blog post + X launch thread + LinkedIn launch post + dev.to crosspost.
- Wed 04-22: r/ClaudeAI launch post (different angle: token-burn pain). Reply thread on X: "What I got wrong in yesterday's launch — answers to top 5 HN comments".
- Thu 04-23: ride the wake. Newsletter issue #001 ("what shipped, what HN said, what's next"). Ship a v0.3.0 with the top 3 issues filed during HN.
- Sun 04-26: r/cursor post (Sunday afternoon ET = peak Cursor traffic, different angle: "vs @codebase").
- Goal end W2: 1500 stars, 400 installs, 150 activated repos.

**Week 3 (04-27 → 05-03) — Distribution + content**
- Mon 04-27: tutorial B blog post (cross-session memory).
- Tue 04-28: r/ChatGPTCoding launch (cross-agent angle).
- Outreach: Theo, ThePrimeagen, Matt Pocock, Latent Space, Changelog. Pitch: "first local-first MCP that beats Cursor indexing on impact analysis — here are benchmarks."
- Submit to MCP Summit / AI Engineer CFPs.
- Goal: 2 podcast bookings, 1 YouTube video lined up.

**Week 4 (05-04 → 05-10) — ProductHunt + Pro waitlist**
- Tue 05-05: ProductHunt launch (Tuesday best for PH).
- Open Pro waitlist publicly.
- 30-day retro blog post: "Sverklo's first month — what worked, the numbers." Transparency posts get reshared.
- Goal end W4: 4000 stars, 1000 installs, 400 activated repos, 200 Pro waitlist signups.

---

## Experiment backlog (run highest-ICE first)

| # | Hypothesis | Outcome | I | C | E | ICE |
|---|---|---|---|---|---|---|
| 1 | 60s asciinema above the README fold lifts star→install conversion 30% | star/install ratio | 9 | 8 | 9 | 6.5 |
| 2 | `npx sverklo init` (no global install) cuts activation drop-off in half | install→first-call rate | 9 | 8 | 8 | 5.8 |
| 6 | "First 5 minutes" scripted prompt sequence triples activation | activation rate | 8 | 8 | 9 | 5.8 |
| 3 | Auto-writing CLAUDE.md with 3 trigger phrases doubles tool diversity in W1 | median tools/week | 8 | 7 | 9 | 5.0 |
| 4 | Posting `sverklo_audit` reports of famous OSS repos ("I ran sverklo_audit on Next.js") drives 1k stars per post | stars per post | 9 | 7 | 7 | 4.4 |
| 11 | Honesty post: "When sverklo is worse than grep — benchmarks" gets HN front page a 2nd time | HN points | 9 | 6 | 8 | 4.3 |
| 8 | Reply to every "how do I make Claude Code better at large repos" tweet with a sverklo demo gif drives 50 installs/week | UTM installs | 7 | 7 | 8 | 3.9 |
| 5 | A `sverklo review` GitHub Action that risk-scores PRs creates a viral surface | installs from GHA referrer | 10 | 6 | 5 | 3.0 |
| 7 | Cursor indexing benchmark + comparison page wins SEO for "cursor indexing alternative" | organic clicks/mo | 7 | 6 | 6 | 2.5 |
| 10 | Free `sverklo audit <repo>` web service with public report cards + "Powered by sverklo" badge | report card shares | 10 | 6 | 4 | 2.4 |
| 9 | Discord bot in MCP Discord runs `sverklo_overview` on any GH URL | unique invocations | 8 | 6 | 4 | 1.9 |
| 12 | Per-language landing pages (sverklo.com/python, /go) for SEO | organic traffic | 6 | 5 | 6 | 1.8 |
| 14 | Pair with Aider — sverklo's MCP works in any client | Aider-referred | 7 | 5 | 5 | 1.8 |
| 15 | "Sverklo for monorepos" case study with Nx/Turborepo | qualified leads | 8 | 5 | 4 | 1.6 |
| 13 | Anthropic partnership: listed as recommended MCP in Claude Code docs | referrals | 10 | 4 | 3 | 1.2 |

**Run first (ICE ≥ 5):** #1, #2, #6, #3 — all README/onboarding fixes, fast, compounding. Do them in W0.

---

## Viral / loop design

**Loop A — Repo Report Card (sverklo's killer artifact)**

```
Dev runs `sverklo audit` → beautiful markdown report (god nodes, hub files, 
dependency graph SVG, PageRank top 20, "Powered by sverklo" footer)
  → shares in team Slack ("look what this found")
  → teammate clicks footer → installs → audits their repo → [loop]
```

**Activation amplifier:** ship `sverklo audit --share` that uploads (opt-in) to `sverklo.com/r/<hash>` as a beautifully-styled public web page. Like a Speedtest result or Lighthouse report. Now the artifact lives outside Slack — it's a URL you tweet, paste in PRs, drop in standups. Every public report card is a backlink + a demo + a CTA.

**Loop B — PR review comments (the Codecov/Dependabot playbook)**

Ship a GitHub Action that runs `sverklo_review_diff` on every PR and posts a risk-scored comment with "Reviewed by sverklo · install". Every PR in every repo using the action is a daily impression for every reviewer. K-factor estimate: 0.05–0.15 once it lands on 200 active repos because every PR re-impresses on the same teammates and conversion compounds.

---

## SEO foundation (the boring stuff that compounds)

**Critical context:** `site:sverklo.com` returns **zero results** today. The domain has no organic surface area. Nothing changes until GSC is set up and a sitemap is submitted. Day-1 priority.

### Homepage `<head>` fixes (paste-ready)

**Title** (62 chars): `Sverklo — Local-First Code Intelligence MCP for Claude Code & Cursor`

**Meta description** (~158 chars): `Sverklo is the open-source MCP server that gives Claude Code, Cursor, and Antigravity hybrid semantic code search and bi-temporal memory. 100% local.`

**H1**: `The local-first code intelligence MCP for AI coding agents`

**JSON-LD `SoftwareApplication`** (drop in `<head>`):

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "Sverklo",
  "applicationCategory": "DeveloperApplication",
  "operatingSystem": "macOS, Linux, Windows",
  "description": "Local-first code intelligence MCP server with hybrid semantic search, symbol-level impact analysis, and bi-temporal memory for Claude Code, Cursor, and Google Antigravity.",
  "url": "https://sverklo.com",
  "downloadUrl": "https://www.npmjs.com/package/sverklo",
  "softwareVersion": "0.2.9",
  "license": "https://opensource.org/licenses/MIT",
  "author": {"@type":"Organization","name":"Sverklo","url":"https://sverklo.com"},
  "offers": {"@type":"Offer","price":"0","priceCurrency":"USD"}
}
</script>
```

Add: `robots.txt`, `sitemap.xml`, canonical, `<meta viewport>`, OG tags (`og:title`, `og:description`, `og:image` 1200×630, `og:url`, `og:type=website`, `og:site_name`), Twitter Card tags, `<html lang="en">`.

### Three pillar topic clusters

**Pillar A — Local-first code intelligence for AI coding agents** (`/local-first-code-intelligence`)
- Why local-first beats cloud RAG for code search
- BM25 + vector + PageRank: building hybrid code search from scratch
- Running ONNX embeddings on a laptop: all-MiniLM-L6-v2 in production
- The privacy cost of cloud code intelligence in 2026
- Tree-sitter vs LSP vs custom parsers for code indexing
- Indexing 100k files in under 10 seconds
- Why your AI coding agent needs PageRank

**Pillar B — MCP servers for Claude Code, Cursor, and Antigravity** (`/mcp-server-guide`)
- The 15 best MCP servers for Claude Code in 2026
- How to install an MCP server in Cursor (3 ways)
- Google Antigravity MCP setup: per-project workaround
- MCP transports: stdio vs SSE vs HTTP
- Debugging MCP servers: what `mcp doctor` checks
- Building your first MCP server in TypeScript
- MCP vs LSP vs DAP

**Pillar C — Refactoring large codebases with AI agents** (`/refactor-with-ai-agents`)
- Claude Code keeps losing context after compaction. Here's the fix. ← **highest-intent existing-demand query, ship day 1**
- Refactor blast radius: why your AI agent breaks things it shouldn't
- Symbol impact analysis: walking the call graph before you rename
- Persistent memory across coding sessions: bi-temporal git-anchored notes
- Auditing a legacy TypeScript repo with sverklo_audit (case study)
- When grep is still the right tool

### Top 30 keywords (full list in agent output, key targets:)

- **Category-defining:** `mcp server code search`, `code intelligence mcp`, `local code search mcp`, `semantic code search claude code`, `local first code intelligence ai agents`
- **Comparison (high commercial intent):** `claude context alternative open source`, `sourcegraph cody local alternative`, `greptile alternative open source`, `sverklo vs sourcegraph cody`
- **Problem (existing demand):** `claude code lost context refactor`, `claude code large codebase context window`, `claude code memory across sessions`, `refactor blast radius tool`
- **Tutorial (AI Overviews bait):** `how to install mcp server claude code`, `how to add code search to cursor`, `google antigravity mcp config`

### Link-building plan (10 white-hat tactics)

1. Show HN — Tue 04-21 8am ET, technical first author comment
2. PRs to: `wong2/awesome-mcp-servers`, `appcypher/awesome-mcp-servers`, `punkpeye/awesome-mcp-servers`, `tolkonepiu/best-of-mcp-servers`, `habitoai/awesome-mcp-servers`
3. Submit to: `mcp.so`, `pulsemcp.com`, `mcpcat.io`, `lobehub.com/mcp`, `smithery.ai`, `glama.ai/mcp/servers`, `cline.bot/mcp-marketplace`, `mcphub.ai`, `mcpservers.org`
4. PRs to: `awesome-claude-code`, `awesome-cursor`, `awesome-llm-apps`, `awesome-rag`, `awesome-developer-tools`
5. Guest posts: dev.to (direct), The New Stack, InfoQ, Hacker Noon, Better Programming
6. Podcast pitches: Software Engineering Daily, Changelog, PodRocket, Practical AI, Latent Space, MLOps Community, AI Engineer Podcast
7. CFPs: AI Engineer Summit, AI Engineer World's Fair, MLOps World, FOSDEM Devtools track, KubeCon CloudNative AI Day
8. Newsletters: Console.dev, TLDR (AI / Webdev), Pointer.io, Bytes.dev, JavaScript Weekly, Node Weekly, Pycoder's, Changelog Nightly, Hacker Newsletter
9. OSS partnerships: Aider (sverklo as repo-map provider), Continue.dev (context provider), Cline (MCP integration)
10. Founder-led X/LinkedIn `#buildinpublic` series tagging Anthropic devrel, MCP maintainers (David Soria Parra), Cursor team

### AEO (AI Overview citations)

- Lead with one-sentence definition, present tense, third person, line 1.
- Numbered "what it does" lists (LLMs love `1./2./3.`).
- Comparison tables with explicit competitor names (Claude Context, Cody, Continue, Aider, Greptile).
- FAQ section with literal Q&A phrasing matching real queries, wrapped in `FAQPage` JSON-LD. Each answer 40–60 words, declarative, no hedging.
- Hard numbers in `<table>` not images.
- One sentence per paragraph in value-prop sections.
- Datestamp: "Last updated: 2026-04-XX".

### 90-day forecast

| | Day 30 | Day 60 | Day 90 |
|---|---|---|---|
| **Worst** (P0 fixed, no HN traction) | 50–150 visits/mo | 200–400/mo | 400–800/mo |
| **Realistic** (mid HN, 3+ awesome lists, 8–12 posts, 1 podcast) | 400–800/mo | 1.5k–3k/mo | 4k–8k/mo, top-10 for 20+ keywords, first AI Overview citations |
| **Best** (HN #1, viral X, Console.dev feature, 1k+ stars) | 1.5k–4k/mo | 6k–12k/mo | 15k–30k/mo, top-3 for "mcp server code search" |

---

## Reddit playbook (the full version is in `LAUNCH_CONTENT.md`)

**Reality check:** founder has no karma'd Reddit account. **The 14-day lurk-and-comment plan is the actual launch — the posts are just the visible part.**

**Tier A subs (launch here):** r/LocalLLaMA, r/mcp, r/ClaudeAI, r/cursor, r/ChatGPTCoding.
**Tier B (W3+):** r/devtools, r/opensource, r/coolgithubprojects, r/commandline, r/typescript.
**Tier C — never launch here:** r/programming (link post only, deep technical writeup), r/MachineLearning (only `[P]` with eval methodology + baselines), r/ExperiencedDevs (will roast and ban — comment-only, reactive disclosure only), r/rust/r/golang (off-topic for a TS tool, only post language-specific angles).

**Posting calendar (post launch over 9 days, never same day on multiple subs — Reddit's spam classifier flags identical/similar cross-posts):**

| Day | Sub | Notes |
|---|---|---|
| Mon 04-15 | r/LocalLLaMA | Stay in comments for 6h. Highest leverage post. |
| Tue 04-16 | r/mcp | Different audience. Won't trigger cross-post filter. |
| Wed 04-17 | (rest, reply only) | |
| Thu 04-22 (post-HN) | r/ClaudeAI | Different angle: token-burn pain |
| Sun 04-26 | r/cursor | Different angle: vs @codebase |
| Tue 04-28 | r/ChatGPTCoding | Cross-agent angle |

**Hard rules:**
1. Never post same title/first paragraph in two subs.
2. Never use Reddit's cross-post button.
3. No "revolutionary", "game-changer", "AI-powered" in titles. AutoMod kills these.
4. Disclose authorship in body of every post.
5. First author comment goes up immediately on submission.
6. If a post is downvoted/removed in first 30 min, do not delete and resubmit. Wait 48h, fix the framing, post a different angle next week.

**Red flag specific to Sverklo:** never run `sverklo init` in a video demo on a repo with secrets. Someone will pause the frame.

---

## Voice & tone (everything published must pass this)

**5 do's:**
1. Lead with the pain — a concrete moment the reader lived this week.
2. Use real numbers ("640ms", "<50ms p95", "200MB"). Not "fast", not "lightweight".
3. Name competitors and explain trade-offs. Pretending they don't exist is insulting.
4. Show terminal output and code, not screenshots of marketing decks.
5. Say when sverklo is the wrong tool. The "when grep wins" section is the most trust-building thing on the site.

**5 don'ts:**
1. No "unleash", "supercharge", "revolutionize", "game-changing", "10×".
2. No emoji as decoration.
3. No "in today's fast-paced AI landscape" openers. First sentence is the hook.
4. No vague benefits. "Better context" is meaningless. "Returns 12 ranked symbols instead of 200 grep matches" is a sentence.
5. No "please RT", no engagement-bait questions. End with the install command.

---

## What I need from Nikita to tighten this further

1. **Live sverklo.com HTML or screenshot** — both research agents were sandbox-blocked from fetching it. Run the §SEO checklist against the live page.
2. **Current GH stars, npm weekly downloads, beta-user count** — targets here are calibrated to "starting near zero".
3. **Confirmation that v0.2.9's MCP prompts already expose `/sverklo:*` slash commands** in Claude Code. If yes, lean on them hard in launch posts.
4. **Whether opt-in telemetry exists today** — if not, this is the W0 critical path. Without it, every funnel decision is a guess.
5. **3 beta-user testimonials** — get them this week.
6. **Real numbers** for the value-thread benchmarks (mark `[NIKITA: ...]` in `LAUNCH_CONTENT.md`) — verify on the sverklo repo before posting.

# X launch thread — v0.2.16

## Format

**8 tweets.** Post in order, no gaps > 30 seconds between 1 and 2 (the hook needs to land immediately). Then pace: tweets 3-8 can be posted over 2-3 minutes.

Pin tweet 1 to your profile immediately after posting.

---

## Tweet 1 — the hook (pinned)

> I got tired of MCP code search tools either
>
> (a) uploading my codebase to someone else's cloud
> (b) hallucinating functions that don't exist
>
> So I built Sverklo. Runs locally, indexes react in 2.5 minutes, MIT licensed. Benchmarks on real repos, not toy projects 👇
>
> [DEMO GIF: 10 seconds of Claude Code asking "where's auth handled?" → sverklo returns 3 ranked files with file paths → compared to ripgrep returning 800 lines of noise]

**Notes:**
- Opens with a shared pain point (not with "I built X")
- Names the two specific failure modes — concrete, not vague
- "runs locally" is the tiebreaker, not the lead
- Ends with a hook for the thread ("benchmarks below")
- **The GIF is the most important asset.** Record it at 1080p, ≤10 seconds, no voice, captions only. If you only ship one piece of media, it's this.

---

## Tweet 2 — the benchmark

> Benchmarked on three public repos, pinned refs so anyone can re-run:
>
> gin (99 files): 10s index, 12ms search p95
> nestjs (1,709): 22s, 14ms p95
> react (4,368): 152s, 26ms p95
>
> One command: `npm run bench`
>
> Full methodology: github.com/sverklo/sverklo/blob/main/BENCHMARKS.md

**Notes:**
- Real numbers, named repos, pinned versions implied (the BENCHMARKS.md link makes this explicit)
- The "one command" line preempts the "did you cherry-pick this?" question

---

## Tweet 3 — what it does (skim-friendly)

> What sverklo actually does:
>
> 🔍 Hybrid search (BM25 + ONNX vectors + PageRank, fused via RRF)
> 🕸️ Symbol-level impact analysis — walks the call graph before you rename
> 📝 Diff-aware PR review with risk scoring
> 🧠 Bi-temporal memory tied to git SHAs
>
> All 20 tools in one MCP server. All local.

**Notes:**
- Emoji used sparingly and for scanning — 4 is the max before it looks spammy
- Each line is a concrete capability, not a feature bullet
- "All 20 tools" is a quiet flex — some readers will click to see what all 20 are
- "fused via RRF" signals you understand what you're doing without bragging

---

## Tweet 4 — the honesty section (the one that gets quote-tweeted)

> Where sverklo is NOT the right tool:
>
> ❌ Exact string search — ripgrep is faster, use it
> ❌ Single-file edits — git diff + Read is hard to beat
> ❌ Small codebases (<50 files) — just read everything
> ❌ "how is this @Component registered" — grep the annotation
>
> Tool selection > tool loyalty.

**Notes:**
- This is the tweet that earns the most quote-retweets in my research on successful dev-tool launches. Nobody brags about weaknesses — people quote-tweet it because it's rare.
- "Tool selection > tool loyalty" is the closing line. Short, quotable, memorable.
- **Do not cut this tweet from the thread even if it feels risky.** This is what differentiates you from the over-promising launches that got roasted (Devin, Reflection 70B).

---

## Tweet 5 — the install

> Install:
>
> npm install -g sverklo
> cd your-project && sverklo init
>
> Auto-detects Claude Code, Cursor, Windsurf, Antigravity. Writes the MCP config files. Appends your CLAUDE.md. Safe to re-run.
>
> MIT. Zero telemetry by default. No API keys.

**Notes:**
- Install command is the second most important thing in the thread after the GIF
- "Safe to re-run" addresses a common anxiety
- "Zero telemetry by default" + "No API keys" close the trust loop

---

## Tweet 6 — the dogfood story (social proof)

> I ran a structured 3-session dogfood protocol using sverklo on sverklo's own codebase before shipping v0.2.16.
>
> Session 1: found 4 tool bugs
> Session 2: audited fixes + one follow-up
> Session 3: one refactor, zero bugs
>
> Full log: github.com/sverklo/sverklo/blob/main/DOGFOOD.md

**Notes:**
- This is the story nobody else has. "I used my tool on itself and it caught four of its own bugs" is unique social proof.
- The log file is public and unedited — readers who click will see the raw observations, not a sanitized case study. That's the credibility.

---

## Tweet 7 — the dashboard (the feature nobody expects)

> Oh, and there's a local web dashboard.
>
> `sverklo ui` opens it at localhost:3847. Dependency graph colored by language, sized by PageRank. Search playground. Memory timeline with bi-temporal invalidation. File browser with chunk-level detail.
>
> Runs offline, obviously. [SCREENSHOT]

**Notes:**
- **This is the element most likely to get quote-retweeted after the weakness tweet.** Visual payoff + local-first + "nobody else is doing this for a code MCP" = shareable.
- **The screenshot is mandatory.** Without it, this tweet is much weaker. Open `sverklo ui` on the sverklo repo itself, navigate to the dependency graph view, capture at 1600x1000 or similar crop. Save to `sverklo-site/dashboard.png` and reference it here.
- Keep "Runs offline, obviously" as the closing — it ties back to the whole thread's local-first thesis without being preachy about it.

---

## Tweet 8 — the CTA

> Repo: github.com/sverklo/sverklo
> Docs: sverklo.com
> Playground: sverklo.com/playground (browse real query output on gin/nestjs/react with zero install)
>
> If you try it, tell me what breaks. I triage within hours during launch week and ship patch releases for real bugs within 24h.

**Notes:**
- Three links, not four — don't add a "buy me a coffee" or similar
- "If you try it, tell me what breaks" is the right close — invites engagement, sets the expectation of responsiveness, avoids begging for stars
- "I triage within hours" is a commitment you need to actually honor. Don't make it if you won't.

---

## Reply camping rules

Same as the HN playbook: reply within 5 minutes for the first 3 hours, never be defensive, thank critics, link evidence.

X-specific: **don't reply to your own thread to boost it**. The algorithm penalizes that. Let it breathe organically. Engage only with real replies from others.

---

## Do NOT post these tweets

- "This is the fastest MCP code server ever 🚀🚀🚀" — gets dunked on
- "If you like sverklo please retweet ❤️" — begging for RTs is transparent
- "RIP grep 💀" — invites the grep-is-fine crowd to correct you
- "Finally solved code search for AI agents" — superlative, will be quoted back at you on the first failure
- "We're hiring!" — off-topic, looks desperate
- "Check out my other projects" — scope creep, dilutes the launch narrative

---

## If the thread goes viral (>1000 likes on tweet 1)

Add a 9th tweet, 2-4 hours after the initial burst:

> Update for the new folks:
>
> Since this thread went up, 3 new GitHub issues have been filed. 2 are already fixed in main, 1 is shipping in v0.2.17 tonight. Every bug gets a response within 4 hours.
>
> The track record is public: 16 issues filed pre-launch, 16 closed. Keeping it that way.

Only post this if it's true. Don't fabricate fix cadence for theater.

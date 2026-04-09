# Sverklo Relaunch Playbook — Week 2

_Written the same day as the first launch attempt (2026-04-09) while the lessons are fresh._

## What happened on launch day 1 (2026-04-09)

Shipped cleanly. Executed the pre-planned multi-channel launch. **Got hit hard by mod filters and account-age penalties on almost every channel.**

| Channel | State | Why |
|---|---|---|
| HN Show HN | auto-flagged within 2min, no comment form rendered, invisible on /newest | Marketing-shaped title + short text-field summary + default-generated username tripped HN's ML spam detection |
| r/LocalLLaMA | manually removed by mods after ~20 minutes | Rule 4 (self-promotion) enforcement against a new/default-username account |
| r/ClaudeAI | survived but degraded to 1:2 upvote ratio | One hostile comment ("it's just a next-token predictor") landed at the top, no organic upvotes came to balance it |
| X thread | posted 8 tweets, low organic reach | Russian-language account with Russian follower base; X algorithm served the thread to the wrong audience |
| sverklo.com traffic | ~12 pageviews all day, 10 of them direct/self | Nobody clicked through to the landing page from any channel |

**Cumulative launch-day signal**: effectively zero. The infrastructure side (npm, docs, playground, analytics) is healthy. The distribution side took a beating.

**Important note**: this is NOT because the product is bad. The 4 dogfood-caught bugs are all fixed, the tests are all green, the benchmarks are real. The failure is distribution, not product.

## What actually went wrong — root causes

### 1. Account reputation (biggest factor)

**HN** autoflag heavily weights account age, karma, and submission history. `nike-17` has an HN account but likely low submission volume → treated as "new account promoting product" → killed.

**Reddit** showed the 1/10 rule warning on r/LocalLLaMA and `Parking-Geologist586` is a default-generated username. Reddit AI signals this as "throwaway account" → mods remove aggressively.

**X** algorithm trusts accounts with high-engagement history in the target language. `@marazmo` has Russian-language history → English thread gets suppressed.

**Every single channel penalized the account, not the content.** This is the dominant factor.

### 2. Title and framing shape

The Show HN title was "local-first code intelligence for Claude Code and Cursor" — mentioning two product brands in a single line reads as marketing copy to HN's heuristics. The text-field summary was three sentences of brand terms ("local-first," "zero telemetry," "MIT") which also read as marketing.

The r/LocalLLaMA post was technically strong (data-first framing) but the **body length + number of self-owned links** (7 links to GitHub paths in one post) tripped both automod and mod review.

### 3. Submission timing and rhythm

Posting HN + X + r/LocalLLaMA + r/ClaudeAI all within a 90-minute window pattern-matches to "coordinated spam campaign" to cross-platform detection systems. Not because it is — because it looks like it.

Staggering over 48-72 hours looks more like organic community engagement.

### 4. Zero community warming

No prior comments, no prior helpful answers, no prior posts on r/LocalLLaMA / r/ClaudeAI / r/opensource before launching. Mods on those subs have strong heuristics for "first post is a product showcase" and treat it skeptically.

Communities reward people who participated before they promoted.

## Relaunch strategy — principles

### Fix the account problem first, or accept that no content will save you

This is the single highest-leverage change. Before relaunching:

1. **Reddit**: use a named account with 30+ days of history and at least some comment karma. Either (a) rename the existing account if possible, (b) warm up a second account by commenting helpfully on related subs for a week, or (c) find a co-conspirator with a real Reddit account to cross-post.

2. **HN**: the existing `nike-17` account is fine if you start submitting *other people's content* (interesting articles, other OSS projects) in the lead-up. HN trusts accounts that submit non-self-promo content. Build a small submission history.

3. **X**: this one is hardest because the algorithm's language weighting is sticky. Options:
   - Create a fresh `@sverklo` product account. Warm it up for a week with technical commentary from existing dev Twitter accounts. Post the launch from the new account.
   - OR accept X will be a minor channel and focus on Reddit + HN + word-of-mouth.

### Warm up communities BEFORE the launch

Spend 5-7 days leading up to launch day doing ONE thing:

**Find 3-5 posts per day in target subs where someone asks a question sverklo could answer** — "how do I find all callers of this method," "which files in this repo matter most," "I need to rename a class across a big codebase" — and leave a helpful comment that doesn't mention sverklo at all. Build reputation as "helpful technical commenter in these subs."

After a week of that, the account has:
- Recent comment history in the exact subs you'll launch in
- Non-self-promo contribution ratio (fixes the 1/10 rule)
- Familiarity with mods' tone and enforcement patterns
- Maybe even a few karma points

**This single change is the biggest lever** for relaunch success.

### Change the hero angle

Launch 1 hero: "local-first code intelligence MCP server with hybrid search."

Launch 2 hero: **"I found 4 bugs in my own tool by dogfooding it — here's the full unedited log."**

Why this works:
- Unique — nobody else in this space has shipped a public dogfood log
- Self-critical — disarms the "is this marketing" reflex
- Concrete — four specific bugs with root-cause analysis
- Technical — attracts exactly the audience who cares
- Transferable — can be the hero on every channel (HN, Reddit, X, blog, talk)

The feature list becomes the second section, not the first. The benchmark table becomes the proof, not the pitch.

### Stagger channels over 72 hours, not 2 hours

```
Day 0, 8am PT:  HN Show HN (camp thread 3h)
Day 0, 6pm PT:  X thread (DM 5 trusted devs ahead)
Day 1, 10am PT: r/opensource (dogfood story angle)
Day 1, 2pm PT:  Blog post on sverklo.com (long-form dogfood retrospective)
Day 2, 10am PT: r/LocalLLaMA (if r/opensource post was decent)
Day 2, 2pm PT:  r/ClaudeAI (if earlier posts are alive)
Day 3:          Lobste.rs, dev.to mirror, Mastodon
```

This looks like organic interest spreading, not a coordinated push.

### Ship a launch blog post as the primary artifact

Instead of making HN the primary channel, make a blog post on **sverklo.com/blog/dogfooding-my-own-code-intelligence-tool** the primary artifact. Every other channel links to it.

Advantages:
- Sverklo owns the URL — no mod can remove it
- The blog post is SEO-indexable and lives forever
- The story is long enough to deserve long-form (2000-3000 words with the session logs embedded)
- Other channels (HN / Reddit / X) become "look at this thing I wrote" posts, which are culturally more welcome than "look at this tool I made"

This flips the launch from "here's my product, please click" to "here's a story about building a product, and if you like the story you can click through to the tool."

## Week 2 launch checklist

### T-7 days (one week before launch)

- [ ] Decide: keep existing Reddit account with warming, or create fresh account
- [ ] Decide: keep X account, create product account, or skip X
- [ ] Start community warming — 3-5 helpful comments per day on r/LocalLLaMA, r/ClaudeAI, r/opensource, r/selfhosted. Do not mention sverklo.
- [ ] Write the launch blog post draft (dogfood retrospective hero)
- [ ] Ship the blog infrastructure improvements (syntax highlighting, OG images, RSS)
- [ ] Record a 90s demo video (still missing from launch 1)
- [ ] Regenerate playground snapshots with real data (carry over from launch 1)

### T-3 days

- [ ] Finalize blog post (have 1-2 people review)
- [ ] Finalize all Reddit / HN / X drafts with the new hero framing
- [ ] Test the launch analytics pipeline is still live
- [ ] Verify CF Worker `/v1/stats/ui` dashboard still works
- [ ] Draft pre-answered FAQ for likely questions (tree-sitter, why MiniLM, etc.)
- [ ] Make sure `sverklo doctor` runs clean on a fresh install

### T-1 day

- [ ] Last dogfood session on the latest npm version
- [ ] Email 3-5 trusted devs who already know about sverklo, give them a private preview of the blog post, ask if they'd RT / upvote when it goes public. **No begging — genuine ask, accept "no" gracefully.**
- [ ] Set calendar block for launch day: 8am-12pm PT, no meetings
- [ ] Close any known issues, ship a fresh patch release if needed
- [ ] Sleep early

### T-0 (launch day)

- [ ] 7:45 AM PT — coffee, open monitoring tabs
- [ ] 8:00 AM PT — publish blog post to sverklo.com/blog
- [ ] 8:05 AM PT — HN submission with URL pointing at the blog post (not GitHub)
- [ ] 8:10 AM PT — start thread-camping HN, reply to every comment within 5 min for 3h
- [ ] 9:30 AM PT — check HN rank; if top 30, wait; if lower, start X thread
- [ ] 10:00 AM PT — X thread, reference the blog post
- [ ] 11:00 AM PT — r/opensource post, linking to blog post
- [ ] 12:00 PM PT — lunch break, don't check anything for 30 min
- [ ] Afternoon — r/LocalLLaMA, r/ClaudeAI, r/selfhosted, spaced 2h apart
- [ ] Day 2 — follow-ups, Mastodon, Lobste.rs

### T+1 day

- [ ] Retrospective — what worked, what didn't, which channel drove the most clicks per npm install
- [ ] Update the playbook

## What to NOT do on the relaunch

- ❌ **Don't resubmit the same URLs to the same subs.** r/LocalLLaMA post is dead forever on that account. Use different URLs (blog post vs GitHub repo) and different framing.
- ❌ **Don't appeal the launch 1 removals.** Silent move-on.
- ❌ **Don't cross-post** — make every post a fresh post with sub-appropriate framing.
- ❌ **Don't mention launch 1 anywhere publicly.** No "I tried launching last week but it didn't go well" — looks needy and unprofessional. Launch 2 is just a launch.
- ❌ **Don't promise features you haven't built.** Every claim in the relaunch needs to be true today, not aspirational.
- ❌ **Don't add more features between now and relaunch.** Scope freeze after T-3 days. Ship what exists.

## Success criteria for relaunch

**Modest**: 300+ GitHub stars, 50+ HN points, 150+ r/LocalLLaMA or r/opensource upvotes, 500+ npm weekly downloads by day 7
**Strong**: 1,000+ stars, 200+ HN points, 500+ combined Reddit upvotes, 2,000+ weekly npm downloads
**Breakout**: 3,000+ stars, front-page HN sustained, featured in a newsletter or dev-tool roundup

Any of these is a successful relaunch. None of them happens automatically — they happen because the launch day was executed with community warming + strong hero + staggered timing + fast reply camping.

## Fallback plan

If launch 2 also gets flagged / removed / zero traction:

1. **Accept the distribution problem is harder than the product problem.**
2. **Pivot to slow organic growth** — write a technical blog post every 2 weeks, post to niche communities (dev.to, HN, Mastodon), wait.
3. **Find a partnership or integration** — if a bigger project mentions sverklo, that's worth more than a successful HN launch.
4. **Accept the product might be ahead of the market** — MCP is still early, most dev teams don't know what an MCP server is. Sometimes you're early and you wait.

**Do not spiral.** The product is good. The audience will find it eventually if the infrastructure is there for them to land on when they do.

## One more idea for the relaunch hero

Instead of "I found 4 bugs by dogfooding," an even sharper framing might be:

> **I used my code-search tool to refactor my code-search tool. Here's what it caught that grep would have missed.**

This is even more specific, even more self-referential, and the "used X to fix X" framing has a long history of going viral (e.g. "we compiled our compiler in itself," "Rustc is written in Rust," etc.). Worth considering.

## Final thought

Launch 1 didn't fail because sverklo is bad. It failed because distribution is hard and the specific accounts used were underweighted by every platform's spam detection. Fix the accounts, fix the framing, stagger the channels, ship a blog post as the anchor, and launch 2 has a genuinely different shot.

**Relaunch target date**: 2026-04-16 (one week out). Gives time for community warming and content prep without losing momentum.

# Launch Day Playbook — v0.2.16

**Target date:** [FILL IN — Tuesday, 8:00 AM Pacific is the highest-signal HN slot]
**Version on npm:** sverklo@0.2.16
**GitHub release:** https://github.com/sverklo/sverklo/releases/tag/v0.2.16

## Pre-launch checklist (T-12 hours)

- [ ] Confirm `npm view sverklo version` returns `0.2.16` as latest
- [ ] Confirm `sverklo.com` and `sverklo.com/playground` load cleanly
- [ ] Confirm `https://github.com/sverklo/sverklo` has ≥ the fake "zero issues, 16 closed" state showing in the issue tab
- [ ] Screen-record the 90-second demo (see DEMO_SCRIPT.md — TODO if not already shot)
- [ ] Upload demo to YouTube as unlisted (we'll link it, not embed)
- [ ] Have BENCHMARKS.md open in a tab for quick reference during HN replies
- [ ] Have DOGFOOD.md open in a tab — session logs are the closing social proof
- [ ] Personal: coffee made, phone on silent, 3 hours blocked starting at 8:00 AM PT
- [ ] Tell your accountability buddy (if any) that launch is happening

## The order of operations (T-0 through T+6h)

```
08:00 PT — Show HN post goes live
            Do not cross-post ANYWHERE yet.
            Set a timer for 3 hours of active thread-camping.

08:05 PT — Begin camping the HN thread.
            Reply to every comment within 5 minutes.
            Never be defensive. Thank critics. Link evidence.
            The goal: keep the discussion alive for the first 3 hours.

09:30 PT — Check HN rank.
            If rank > 20 (i.e. not trending), DO NOT cross-post yet.
            Give the HN thread another 30 minutes.

10:00 PT — If HN rank is still > 20, accept it.
            HN isn't going to carry this launch.
            Move to X now.

10:00 PT — Post the X thread.
            Immediately pin to your profile.
            DM 3-5 trusted devs in the AI-coding space and ask them
            to quote-retweet if they think it's interesting.
            Reply to every reply.

11:00 PT — Post to r/LocalLLaMA.
            Title emphasizes the benchmark table, NOT the tool.
            Data-first framing — r/LocalLLaMA rewards it.

14:00 PT — Post to r/ClaudeAI.
            Title emphasizes the Claude Code integration, NOT the tool.
            MCP-specific angle. Include a screenshot.

17:00 PT — Final HN check. By this point the post has either
            stuck or died. If stuck, write a second-wind reply
            summarizing the top 3 most interesting pieces of
            feedback from the thread.

Day 2, 08:00 PT — r/cursor post. Different angle: "works with Cursor too."
                  Include a screenshot of the .cursor/mcp.json config.

Day 2, 10:00 PT — Product Hunt submission. Lower-priority;
                  PH traffic is lower quality than HN for devtools.

Day 3-7 — Respond to every issue filed. Ship patch releases
           (v0.2.17+) for any real bugs within 24 hours. Turn
           each fix into a brief "shipped in response to X from
           [user]" tweet.
```

## Thread-camping rules

1. **Reply within 5 minutes** for the first 3 hours. After that, within 15 minutes.
2. **Never argue with a critic.** If they're right, thank them and file an issue. If they're wrong, explain politely and cite evidence. Never "well actually." Never dismissive.
3. **Link evidence.** "Here's the benchmark methodology: [link]." "Here's the source for that claim: [link]." People who click and read become advocates.
4. **Acknowledge the "where it's worse" section explicitly.** People love honesty, and the section exists for exactly this moment.
5. **Don't claim you'll "look into" anything.** If you mean it, file an issue publicly right then and link it in the reply.

## What NOT to say

- "This is the best X" — any superlative invites challenge
- "It's like Y but better" — comparisons invite feature-war derails
- "Feel free to star the repo" — begging for stars is transparent
- "Check out our other products" — cross-promotion looks desperate
- "DM me" — keep the conversation public, it's proof of engagement
- "As mentioned in the README" — meet people where they are, re-explain briefly

## What to say when things get rough

**If someone posts a reproducible bug:** "You're right, that's a bug. Filed as [link] — I'll ship a fix within 24 hours." Then actually do it. This is launch-day gold — a visible bug + a visible fix in one day builds more trust than zero bugs would have.

**If someone claims sverklo doesn't work on their repo:** "Can you share the output of `sverklo doctor`? That's usually where the problem surfaces. I'll help debug in the GitHub issue." Move it off HN and into a place where you can actually resolve it.

**If someone compares you unfavorably to Cursor / Sourcegraph / Cody:** "Different problem. Cursor indexes in their cloud, sverklo runs entirely on your laptop. If you're ok with cloud, Cursor's @codebase is great. If you can't ship your code off-device (compliance, air-gapped, just don't want to), sverklo is built for you."

**If someone says "but embeddings aren't real code understanding":** Honest answer — "Agreed. That's why sverklo fuses BM25 + vector + PageRank via RRF instead of just embeddings. The BM25 side handles exact identifier match, the vector side handles intent, the PageRank side handles 'which 5 files actually matter.' No single signal is enough."

## Post-launch success metrics

**Good launch (anything at these thresholds):**
- HN: 150+ points, 40+ comments, front page top 10 for 4+ hours
- r/LocalLLaMA: 200+ upvotes
- r/ClaudeAI: 150+ upvotes
- GitHub stars: +500 in first 24h
- npm downloads: 500+ in first 24h

**Strong launch (compound these with "good"):**
- HN: 400+ points (Continue.dev territory)
- X thread: 10+ quote-retweets from devs in the space
- GitHub stars: +1500 in first week

**Breakout launch (rare):**
- HN: 800+ points (Ollama territory — only happens if the binary is something everyone immediately installs)
- GitHub stars: +5000 in first week

## Post-launch don't-do list

- Don't ship new features for 48 hours. Fix bugs only.
- Don't respond to requests for major features with "great idea, filing it." Say "I'm holding the scope tight through launch week. Filing for later if it holds up as important." Honesty > politeness.
- Don't remove the "when not to use this" section from the README even if it feels risky. That section is what got you past HN scrutiny.

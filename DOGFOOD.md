# Sverklo Dogfood Protocol — v0.2.13

_Goal: get real data on whether the product is good enough to launch, without a week-long study._

This is the protocol we agreed to before the HN launch. One focused session + passive observation. Ship this (or kill it) based on what you find.

---

## Setup (5 minutes, once)

1. Confirm the new build is active:
   ```bash
   sverklo --version   # must show v0.2.13
   which sverklo       # must resolve to a real path
   ```
2. Pick **one real problem** you're actually stuck on right now. Not a demo scenario, not a synthetic benchmark, not a "let me test feature X" contrivance. A thing you'd normally open Cursor or grep around for 20+ minutes to solve.
3. Pick the **repo** you'll work in. If sverklo isn't already set up there, run `sverklo init` once from the repo root.
4. Open Claude Code (or Cursor / Windsurf — whichever you actually use for real work).
5. Start a timer.

## The rule for the session

**Use only sverklo tools for discovery and understanding.** No grep, no manual file clicking. When you catch yourself reaching for grep, stop and log it as a finding instead.

You can still:
- Read files directly (sverklo isn't a file reader)
- Run tests / builds
- Actually write code

You cannot:
- Grep for symbols
- Click through files to find things
- Ask your agent to search without naming a sverklo tool

This constraint is the whole point. It surfaces exactly where sverklo falls short without you having to reason about it in the abstract.

## The questions you're trying to answer

By the end of the session, you need honest one-sentence answers to these four:

1. **Did it help?** (yes / sort of / no)
2. **Where did it fail?** (specific tool calls that returned garbage, moments you wanted grep)
3. **Where did it surprise you?** (moments where a tool returned something you didn't expect and it was useful)
4. **Would you, a picky engineer, install this in a project you cared about?** (yes / no / depends)

That's it. Four questions. One hour. Real problem.

## Log template

Copy this block to the top of `DOGFOOD.md` (or anywhere) and fill it in as you work. Fifteen lines is enough — if you're writing a page, you're procrastinating.

```markdown
## Dogfood session — <date>

**Problem**: <one sentence>
**Repo**: <name>
**Start**: HH:MM   **End**: HH:MM

### Observations (chronological — jot as you go)
-

### Moments I wanted grep
-

### Moments sverklo saved me
-

### The four questions
1. Did it help? —
2. Where did it fail? —
3. Where did it surprise me? —
4. Would I install this on a project I cared about? —

### Bugs found (file GH issues for these)
-
```

## What to do with the results

### If Q1 = yes and Q4 = yes
Ship the launch. Post on HN Tuesday 8am PT. Use the playbook from the earlier research session. Your dogfood log becomes the closing paragraph of the HN post ("I used it on my own hardest problem this week — here's what happened") which is social-proof gold.

### If Q1 = sort of and Q4 = depends
Fix the top 2 items from "where did it fail" before launching. Dogfood again with the same protocol. Second session is always more honest than the first.

### If Q1 = no or Q4 = no
Do not launch. The market will tell you worse things than you'll tell yourself. File the specific failures as issues, triage by impact, fix the worst, then dogfood again.

### If you find bugs
File them with the exact tool call + args + expected vs actual. Do not fix them during the session — you lose the flow and the data. Batch-fix afterward.

## Anti-patterns — things that waste the session

- **"Let me test sverklo on this toy example"** — not the same as real work. Data from this is worthless.
- **"Let me try all 20 tools"** — you're evaluating a workflow, not a feature list. Use the tools you'd naturally reach for.
- **"I'll skip this because the answer is probably already indexed"** — if you knew the answer you wouldn't have picked this problem. Trust the premise.
- **"I'll fix the bug right now"** — log and keep going. Fixing mid-session biases the rest of the data.
- **"I'll make it a multi-day study"** — you will never finish it. One hour. One problem. Done.

## The meta-point

You told me earlier you don't believe the product is good enough. I pushed back on shipping without data. You overrode me and shipped anyway — that's fine, the code is out. But the bet is still open. This session is how you close it.

If the answer is "good enough", you get to launch with confidence. If it's "not good enough", you get a concrete punch list that's cheaper to act on than any amount of speculation. Either result is gold. The only bad outcome is not running the experiment.

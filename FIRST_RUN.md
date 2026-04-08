# First Run — Sverklo in 5 minutes

You installed sverklo and ran `sverklo init`. Your AI coding agent (Claude Code, Cursor, Antigravity, Windsurf) now has 20 new tools. Here's how to feel why they matter, in three prompts.

**Pick a real codebase you actually work in** — not a demo repo. Sverklo's value scales with codebase size and complexity. On a 30-file repo, grep is fine.

---

## Prompt 1 — Map the repo (10 seconds)

Paste this into your agent:

> Run `sverklo_overview` on this codebase and tell me the 5 most structurally important files I should read to understand it. Then summarize what this project does in 2 sentences.

**What just happened:** sverklo parsed your codebase, built a dependency graph, computed PageRank, and surfaced the load-bearing files — not the ones with the most lines or the most recent commits, the ones that *the rest of the code depends on*. Test fixtures don't show up. Generated code doesn't show up. The actual spine of the project does.

**What to compare it to:** ask the agent to do the same thing without sverklo. It will list files alphabetically or by modification date. Different answer.

---

## Prompt 2 — Pick a refactor target (30 seconds)

Pick a function or class you've been thinking about renaming or restructuring. Paste:

> Use `sverklo_impact <YourSymbolName>` to walk the call graph and tell me the blast radius if I rename or change the contract of this symbol. Group the callers by file and flag any test files separately.

**What just happened:** sverklo walked the symbol graph, not the text. The output is the *actual* set of functions/methods/tests that will break if you change that symbol — not the 200 grep matches polluted by unrelated `recharge`, `discharge`, or comment mentions.

**Cross-check with `grep`:** run `grep -rn "<YourSymbolName>" .` and count the noise. The ratio is the win.

---

## Prompt 3 — Save a decision the agent will forget tomorrow (1 minute)

Find one non-obvious decision in the codebase — a magic number, a retry delay, a workaround for a third-party bug, a "we tried this and it broke" comment. Paste:

> Use `sverklo_remember` to save this decision: "<short text>. Reason: <why>. Verified: <when/how>." Tie it to the relevant file. Then in your next session I will ask you about it without context.

Then **start a new agent session** (close and reopen, or `/clear` in Claude Code) and paste:

> I have a question about <the topic>. Use `sverklo_recall` to find anything we've decided about it.

**What just happened:** the decision came back from a fresh session, with the git SHA it was made against and a status flag — *still valid* if the underlying code hasn't moved, *stale* if it has. This is what context compaction can't kill.

---

## When you're done

You've now touched the three things sverklo does that built-in tools don't: **structural ranking**, **symbol-graph impact**, and **bi-temporal memory**. Everything else in the tool list is a refinement.

Next steps:
- Read the [README's "When sverklo helps and when it doesn't"](README.md#when-sverklo-helps) section. Honest about the cases where grep wins.
- Run `sverklo doctor` if anything didn't work — it diagnoses the common MCP setup failures and tells you exactly what to fix.
- Open the dashboard with `npx sverklo ui .` to browse the index, search, dependency graph, and saved memories visually.
- Try `sverklo_review_diff` on your current working branch — it's the diff-aware MR review tool with risk scoring.

If any of these prompts produced a bad result on a real codebase, [open an issue](https://github.com/sverklo/sverklo/issues) — retrieval quality is the metric we most care about.

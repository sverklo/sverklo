# X thread — v0.2.11 release ("what shipped today")

**Goal:** build-in-public momentum tweet for the 13 days before launch. Different from the launch thread (§3 of LAUNCH_CONTENT.md). This one is technical, narrow, and aimed at the small audience already paying attention — not a launch.

**When to post:** within 24 hours of v0.2.11 hitting npm. So roughly **today**, 2026-04-08.

**Tone check before posting:** no emoji as decoration, no "🚀 excited to share", no "thrilled", no "we're proud to announce". Lead with the technical decision, not the announcement.

---

## Tweet 1 (the hook — must stop the scroll)

sverklo v0.2.11 ships today. The hard one was telemetry.

I needed to know how many install_id pairs activate per week without breaking the "no telemetry" promise on the README. Here's exactly what we collect, how we collect it, and the parts I refused to ship.

## Tweet 2 (the schema)

Nine fields per event. That's the entire surface area:

```
install_id     UUID v4 generated locally on opt-in
version        sverklo version string
os             darwin / linux / win32
node_major     int
event          one of 17 fixed enum values
tool           sverklo_* name (or null)
outcome        ok / error / timeout
duration_ms    int
ts             added server-side, never client-side
```

## Tweet 3 (the deny list — load-bearing)

Things we deliberately do NOT collect, ever:

— code, queries, file paths, symbol names
— memory contents
— git SHA, branch, repo URL
— IP addresses, hostnames, usernames
— error messages, stack traces
— language breakdown, file counts (those fingerprint a repo)

If you can't answer a product question with the 9 fields above, telemetry can't answer it.

## Tweet 4 (off by default)

Off by default. The `sverklo telemetry enable` command prints the entire schema and asks you to type `yes` before anything is sent.

Disabled file always wins. Even if both `~/.sverklo/telemetry.enabled` and `.disabled` exist (race / corruption / paranoia), we treat the user as opted out.

## Tweet 5 (the local mirror)

Every event is appended to `~/.sverklo/telemetry.log` BEFORE the network call.

You can `tail -f` it and see exactly what we tried to send, even if the network is down. There is nothing the binary sends that you can't read on disk first.

`sverklo telemetry log` tails it for you.

**[SCREENSHOT 1: terminal showing `sverklo telemetry log` output with one opt_in event pretty-printed]**

## Tweet 6 (the endpoint)

Endpoint is a Cloudflare Worker we own at t.sverklo.com.

— Source: github.com/sverklo/sverklo/tree/main/telemetry-endpoint (~150 lines, single file)
— Storage: R2 NDJSON files keyed by UTC date
— Retention: 90 days, auto-deleted via R2 lifecycle policy
— No third parties. No PostHog. No Segment. No Plausible.

The whole pipeline is intentionally tiny so you can audit it in 60 seconds.

## Tweet 7 (the validation)

The Worker doesn't trust the client. Schema validated explicitly, anything outside the whitelist dropped.

Test 13 from the smoke test sends `{secret, path, query}` as extra fields. They're stripped on the server side before storage. Defense in depth — if the client has a bug, the server won't honor it.

## Tweet 8 (the receipts)

Real benchmarks shipped today too. Replaced the old 38-file toy figure in the README with three real codebases:

| repo    | files | cold idx | search p95 | impact |
|---------|------:|---------:|-----------:|-------:|
| gin     | 99    | 10 s     | 12 ms      | 0.75ms |
| nestjs  | 1709  | 22 s     | 14 ms      | 0.88ms |
| react   | 4368  | 152 s    | 26 ms      | 1.18ms |

## Tweet 9 (the honest trade-off)

The 152 seconds for React is the headline trade-off. ~7 ms per chunk on Apple Silicon, paid once per project, then incremental refresh only re-processes changed files.

I could have buried this number. I'd rather you decide it's worth the cost than discover it after install.

Full methodology: github.com/sverklo/sverklo/blob/main/BENCHMARKS.md

## Tweet 10 (the install)

```
npm install -g sverklo@latest
cd your-project && sverklo init
```

If you want to opt in to telemetry on a fresh install:

```
sverklo telemetry enable
```

You'll see the schema, type yes, become install_id #N for some small N this week.

## Tweet 11 (the call to read code, not vibes)

The whole pipeline is tiny on purpose:

— src/telemetry/index.ts (the entire client, ~250 lines)
— src/telemetry/types.ts (the schema)
— telemetry-endpoint/worker.ts (the receiving Worker)

If anything in those three files surprises you, open an issue. Privacy correctness is one of two metrics I most care about (the other is retrieval quality).

## Tweet 12 (the close)

Shipping out loud because I'd rather have one HN comment that says "this is reasonable" than ten that say "what's the catch."

Source code, design doc, locked decisions, the 7 questions and their answers — all in the repo. Read before you trust.

github.com/sverklo/sverklo · sverklo.com

---

## Notes for Nikita

- **Length:** 12 tweets is long for a release post but justified — telemetry is the load-bearing trust signal and a single-tweet launch undersells it. If you want a shorter version, cut tweets 6, 7, and 11.
- **Screenshot 1** in tweet 5 needs you to actually capture the local log after opting in on your machine. The `b1f450cf-...` event from earlier today is fine to use, or generate a fresh one.
- **Don't @-mention** Anthropic / Cursor / Cloudflare — they get pinged a lot and tagging looks like reach-bait. Mention by name in tweet 6 ("Cloudflare Worker") but no @-handle.
- **Pin** this thread to your X profile until 2026-04-21 so anyone landing on your profile in the days before launch sees the technical depth, not just marketing tweets.
- **Don't auto-cross-post** to LinkedIn — write a separate, shorter LinkedIn version (200 words, professional, no code blocks). Different audience.
- **HN crosspost?** No. Save the HN attention for the Show HN on Tue 2026-04-21. Posting the v0.2.11 release as a separate HN thread first burns the algorithm goodwill on the wrong story.

# Telemetry

**Status:** off by default. You have to explicitly opt in. Reading this page is enough to know exactly what gets sent if you do.

This is the user-facing summary. The full design rationale lives in [`TELEMETRY_DESIGN.md`](./TELEMETRY_DESIGN.md). The endpoint source is in [`telemetry-endpoint/`](./telemetry-endpoint/).

---

## TL;DR

| Question | Answer |
|---|---|
| Is it on? | Off. Always off until you run `sverklo telemetry enable`. |
| Can I opt out? | Yes — `sverklo telemetry disable`. Permanent per machine. |
| What gets sent? | 9 fields, no code, no queries, no paths. See below. |
| Where does it go? | A Cloudflare Worker we own at `t.sverklo.com`. Source in this repo. |
| How long is it kept? | 90 days. Auto-deleted after that. |
| Can I see what it sends? | Yes — `sverklo telemetry log` tails a local mirror of every event. |
| Will my code be sent anywhere? | **No.** That's the whole point. |

---

## Enable

```
sverklo telemetry enable
```

You'll get an interactive prompt that prints the exact schema and asks you to type `yes`. Nothing is sent until you confirm.

To skip the prompt (for scripts):

```
sverklo telemetry enable --yes
```

## Disable

```
sverklo telemetry disable
```

Removes the install-id, writes a `~/.sverklo/telemetry.disabled` sentinel, and never sends again. Sends one final `opt_out` event before tearing down. The disabled state is persistent — you have to explicitly run `enable` again to re-opt-in.

## Status

```
sverklo telemetry status
```

Prints whether telemetry is on, your install-id (if opted in), the endpoint URL, and the local log path.

## See exactly what's been sent

```
sverklo telemetry log
```

Tails `~/.sverklo/telemetry.log`. Every event is mirrored to this file **before** the network call, so even if the network is down, you can see what we tried to send.

---

## What we collect (the entire schema)

Every event is one JSON object with these 9 fields:

| Field | Type | Example | Why |
|---|---|---|---|
| `install_id` | UUID v4 | `9e1c4a8b-...` | Distinct repo-machine pair, generated locally on opt-in |
| `version` | string | `"0.2.10"` | Which sverklo version |
| `os` | enum | `"darwin"` / `"linux"` / `"win32"` | Platform-specific bug triage |
| `node_major` | int | `22` | Which Node we run on |
| `event` | enum | `"tool.call"` | One of 17 fixed event types (see below) |
| `tool` | enum or null | `"sverklo_search"` | Tool name; null if not a tool event |
| `outcome` | enum | `"ok"` / `"error"` / `"timeout"` | Coarse success indicator |
| `duration_ms` | int | `47` | Tool execution time, integer ms |
| `ts` | int | `1712534400` | Unix seconds — added server-side, not client-side |

**That is the entire surface area.** Adding a field requires a public PR that touches `src/telemetry/types.ts`, `worker.ts`, and this file.

---

## The 17 event types

```
init.run                     // sverklo init was executed
init.detected.claude-code    // detected Claude Code
init.detected.cursor         // detected Cursor
init.detected.windsurf       // detected Windsurf
init.detected.vscode         // detected VS Code
init.detected.jetbrains      // detected JetBrains
init.detected.antigravity    // detected Google Antigravity
doctor.run                   // sverklo doctor was executed
doctor.issue                 // doctor found a fixable issue (count via repeats)
index.cold_start             // first index of a project completed (with duration)
index.refresh                // incremental refresh completed (with duration)
tool.call                    // any sverklo_* tool was invoked (with name + outcome + duration)
memory.write                 // sverklo_remember was called
memory.read                  // sverklo_recall was called
memory.staleness_detected    // a recall returned a stale memory
session.heartbeat            // emitted at most once per hour while sverklo is running
opt_in                       // user opted in (sent once)
opt_out                      // user opted out (sent once, before tear-down)
```

Anything not in this list is not collected. Adding to this list requires a PR.

---

## What we deliberately do NOT collect

Not by accident. Not "for now." **Never.**

- **Query strings to `sverklo_search`** — never. Not hashed, not truncated, not encoded.
- **File paths or symbol names** in any field. Even `tool.call` doesn't include arguments.
- **Memory contents** from `sverklo_remember` / `sverklo_recall`.
- **Git SHA, branch name, repo URL, or anything that identifies a project.**
- **Codebase size or file counts** — combined with other signals these can fingerprint a repo.
- **Language breakdown** — same reason.
- **Error messages or stack traces** — those can contain paths and identifiers.
- **IP addresses** — the endpoint discards `X-Forwarded-For` before logging.
- **User-Agent beyond the literal `sverklo/<version>` string** — no Node version string, no OS version, no hostname.
- **Cookies, sessions, auth headers, query parameters** — the endpoint accepts none of these.

---

## How to verify

The promise above is only as good as the source code you can read. Three places to look:

1. **[`src/telemetry/index.ts`](./src/telemetry/index.ts)** — the entire client (~250 lines). One file, no dynamic imports, no plugin system. Read it end-to-end.
2. **[`src/telemetry/types.ts`](./src/telemetry/types.ts)** — the schema. If a field isn't in this file, the binary cannot send it.
3. **[`telemetry-endpoint/worker.ts`](./telemetry-endpoint/worker.ts)** — the receiving Cloudflare Worker. Validates against the same schema, drops everything else.

If any of these surprise you, open an issue at https://github.com/sverklo/sverklo. The whole pipeline is intentionally tiny — the audit should take 60 seconds, not 60 minutes.

---

## Why this exists at all

Right now, every funnel decision sverklo makes is a guess. We don't know:
- How many people who run `sverklo init` ever issue a single tool call
- Which of the 20 tools are actually getting called on real codebases
- Whether `sverklo doctor` is finding real setup issues for users
- Whether a v0.2.x install-flow fix actually improved activation
- What the day-7 retention curve looks like

Without those numbers, we can't tell which improvements are worth shipping. The choice was: ship telemetry that earns its place, or keep flying blind. We picked the smallest possible amount of data that lets us answer those questions, collected only with explicit consent, hosted on infrastructure we own, with a pipeline anyone can audit.

If you don't want to participate, that's the default. If you do, thank you — the data shapes what gets fixed first.

---

## Public stats

After 90 days of data accumulated, an aggregated subset will be published at `https://sverklo.com/stats`:
- Weekly active repos (rolling 7-day count of distinct install_ids with ≥1 tool call)
- Activation rate (% of new installs issuing ≥3 tool calls within 24h)
- Day-7 retention curve

No per-user data. No raw events. Just the kind of numbers a privacy-respecting transparency report publishes.

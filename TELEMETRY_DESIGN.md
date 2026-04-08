# Telemetry Design — opt-in, privacy-preserving

**Status:** design **LOCKED 2026-04-08**, ready to implement.
**Author:** drafted 2026-04-08, decisions interactively confirmed by Nikita 2026-04-08.

## Locked decisions (the 7 open questions)

| # | Decision | Choice |
|---|---|---|
| 1 | Endpoint domain | **`t.sverklo.com`** (subdomain on Cloudflare Worker) |
| 2 | Event volume cap | **No cap** — trust the binary, no per-day limit |
| 3 | `opt_in`/`opt_out` events | **Send both** — measure conversion + churn explicitly |
| 4 | Storage backend | **Cloudflare Worker + R2** (NDJSON daily files), nothing on third parties |
| 5 | Init nudge | **One line, first init only**, gated by `~/.sverklo/init-nudged` sentinel |
| 6 | Retention | **90 days** with auto-delete lifecycle policy on R2 |
| 7 | Public stats page | **Yes, eventually** — `sverklo.com/stats` after 90 days of data accumulated |

These decisions are now load-bearing. Any change requires a separate design discussion before implementation drift.
**Constraint:** every line of this doc has to be defensible on Hacker News and r/LocalLLaMA. The README's "no telemetry" promise is load-bearing for the brand. We can only ship telemetry that survives the most skeptical reading by a privacy-aware engineer.

---

## Why we need this at all

Right now every funnel decision is a guess. We don't know:
- How many people who run `sverklo init` ever issue a single tool call
- Which of the 20 tools are actually getting called
- Whether `sverklo doctor` is finding setup issues for real users
- Whether v0.2.10's risk-scoring feature is being used
- What the activation → day-7 retention curve looks like

Without that, the launch plan in `LAUNCH_PLAN.md` is operating blind. The North Star Metric (Weekly Active Indexed Repos) is unmeasurable, the activation funnel is a hypothesis, and we can't tell whether a fix to the install flow actually improved anything.

We need the smallest possible amount of data that lets us answer those questions, collected only with explicit consent, and the entire pipeline has to be auditable in two minutes by anyone reading the source.

---

## Hard constraints

1. **Off by default.** First-run sverklo is silent. The user has to type a command or set an env var to opt in.
2. **No code, no queries, no file paths, no symbol names, no diffs, no memory contents.** Ever. None of these leave the user's machine. The thing that makes sverklo different is that your code stays on your laptop — telemetry must not undermine that.
3. **No identifiers tied to identity.** No IP addresses, no hostnames, no usernames, no project names, no git remote URLs, no email.
4. **One opaque install ID** — random UUID generated locally on first opt-in, stored at `~/.sverklo/install-id`. If the user deletes the file, they're a new install. The ID is not tied to anything outside the file.
5. **No third parties.** No Segment, no Mixpanel, no PostHog Cloud. We host the endpoint ourselves on Netlify Functions or a small Cloudflare Worker. The endpoint logs only what we need, retains it for 90 days, and the source for the endpoint is in this repo.
6. **Visible.** Every event the agent collects is mirrored to a local log file the user can `tail -f` to see exactly what gets sent. No hidden network traffic.
7. **One command to opt out at any time, irreversible per-machine.** Opt-out wipes the install ID and adds a sentinel file that the binary checks before sending anything.
8. **Source-auditable in 60 seconds.** All telemetry code lives in one file (`src/telemetry/index.ts`) under 200 lines. No dynamic imports, no plugin system, no metaprogramming.
9. **No telemetry on telemetry.** We don't track who opts in vs out. We don't ping the server to "check if telemetry is enabled". The opt-in command is the only thing that initializes the pipeline.

---

## What we collect (the entire whitelist)

Each event is a single JSON object posted to `https://t.sverklo.com/v1/event`. Fields:

| Field | Type | Example | Why |
|---|---|---|---|
| `install_id` | UUID v4 | `9e1c...` | Distinct repo-machine pair (one per opt-in) |
| `version` | string | `"0.2.10"` | Which sverklo version generated the event |
| `os` | enum | `"darwin" \| "linux" \| "win32"` | Platform-specific bug triage |
| `node_major` | int | `22` | Which Node we run on; informs CI matrix |
| `event` | enum | see below | Event type — bounded set, no free text |
| `tool` | enum or null | `"sverklo_search"` | Tool name, null if not a tool event |
| `outcome` | enum | `"ok" \| "error" \| "timeout"` | Coarse success indicator |
| `duration_ms` | int | `47` | Tool execution time, integer ms |
| `ts` | int | `1712534400` | Unix seconds — server-side, not client-side, to avoid clock fingerprinting |

That is the entire schema. There is no `args`, `query`, `result`, `path`, `repo`, `count`, `language`, `file`, `symbol`, `error_message`, or anything else. If you cannot map a question to those nine fields, we cannot collect it.

### Event types (fixed enum, ~15)

```
init.run                     // sverklo init was executed
init.detected.{client}       // detected an installed client (claude-code, cursor, ...)
doctor.run                   // sverklo doctor was executed
doctor.issue                 // doctor found a fixable issue (no details, just count via repeats)
index.cold_start             // first index of a project completed
index.refresh                // incremental refresh completed
tool.call                    // any sverklo_* tool was invoked (with `tool` field set)
memory.write                 // sverklo_remember was called
memory.read                  // sverklo_recall was called
memory.staleness_detected    // a recall returned a stale memory
session.heartbeat            // emitted at most once per hour while sverklo is running
opt_in                       // user opted in (sent once, then never again)
opt_out                      // user opted out (sent once, then never again)
```

Anything not in this list is not collected. Adding to this list requires a PR with a public design discussion.

---

## What we deliberately do not collect

- **Query strings** to `sverklo_search` — never. Not hashed, not truncated, not encoded.
- **File paths or symbol names** in any field. Even `tool.call` doesn't include arguments.
- **Memory contents** from `sverklo_remember`/`sverklo_recall`.
- **Git SHA, branch name, repo URL, or anything that identifies a project.**
- **Codebase size or file counts** — these can fingerprint a repo.
- **Language breakdown** — combined with stars or repo counts, this fingerprints projects.
- **Error messages or stack traces** — those can contain paths and identifiers.
- **IP addresses** — the endpoint discards `X-Forwarded-For` before logging.
- **User-Agent beyond `sverklo/0.2.10` literal** — no Node version string, no OS version, no hostname.
- **Any cookie, session, or auth header.** The endpoint accepts only the JSON body and a fixed `User-Agent: sverklo/{version}` header.

---

## Opt-in UX (the only place this gets enabled)

```
$ sverklo telemetry enable

Sverklo telemetry is currently OFF. This is what enabling it sends:

  install_id  one random UUID stored at ~/.sverklo/install-id
  version     0.2.10
  os          darwin
  node_major  22
  event       one of 15 fixed event types (see below)
  tool        sverklo_* tool name (when applicable)
  outcome     ok / error / timeout
  duration_ms tool execution time

This is what it does NOT send:
  - No code, queries, file paths, symbol names, or memory contents
  - No IP addresses, hostnames, or project identifiers
  - No git remote URLs, branch names, or SHAs

A copy of every event is mirrored to ~/.sverklo/telemetry.log so you can
see exactly what was sent. The endpoint source code lives at
https://github.com/sverklo/sverklo/tree/main/telemetry-endpoint and the
sending code is at src/telemetry/index.ts (under 200 lines).

Type 'yes' to enable, anything else to cancel.
> _
```

If they type `yes`, we generate a UUID, write `~/.sverklo/install-id`, write `~/.sverklo/telemetry.enabled`, and post one `opt_in` event. From then on, every event the binary emits is also written to `~/.sverklo/telemetry.log` before being POSTed.

To disable: `sverklo telemetry disable` deletes the install-id, writes a sentinel `~/.sverklo/telemetry.disabled`, posts one final `opt_out` event, and never sends again.

To inspect: `sverklo telemetry log` tails `~/.sverklo/telemetry.log`. `sverklo telemetry status` prints whether it's on/off and the install-id.

---

## Implementation sketch

### File layout (sverklo repo)

```
src/telemetry/
  index.ts          ~150 lines, the entire client. Schema, opt-in check, fetch+log.
  types.ts          ~30 lines, the EventType union and OutcomeType.
  README.md         what gets collected, copy of this doc's "What we collect" section.
telemetry-endpoint/
  index.ts          Cloudflare Worker / Netlify Function (~50 lines).
  README.md         Endpoint behavior, retention, source link.
bin/sverklo.ts
  + telemetry enable | disable | status | log subcommands (~40 lines)
```

### Client behavior pseudocode

```ts
// src/telemetry/index.ts
const TELEMETRY_DIR = path.join(os.homedir(), '.sverklo')
const ENABLED_FILE  = path.join(TELEMETRY_DIR, 'telemetry.enabled')
const DISABLED_FILE = path.join(TELEMETRY_DIR, 'telemetry.disabled')
const ID_FILE       = path.join(TELEMETRY_DIR, 'install-id')
const LOG_FILE      = path.join(TELEMETRY_DIR, 'telemetry.log')
const ENDPOINT      = 'https://t.sverklo.com/v1/event'

function isEnabled(): boolean {
  // Disabled file always wins. No check, no network, no nothing.
  if (fs.existsSync(DISABLED_FILE)) return false
  return fs.existsSync(ENABLED_FILE)
}

function getInstallId(): string | null {
  if (!isEnabled()) return null
  try { return fs.readFileSync(ID_FILE, 'utf8').trim() } catch { return null }
}

export async function track(event: EventType, fields: Partial<Event> = {}) {
  if (!isEnabled()) return                    // hard short-circuit
  const id = getInstallId()
  if (!id) return                              // belt + suspenders

  const payload: Event = {
    install_id: id,
    version: pkg.version,
    os: process.platform as Os,
    node_major: parseInt(process.versions.node.split('.')[0], 10),
    event,
    tool: fields.tool ?? null,
    outcome: fields.outcome ?? 'ok',
    duration_ms: fields.duration_ms ?? 0,
  }

  // Mirror locally BEFORE sending. If the network fails, the user still
  // has a record of what we tried to send.
  fs.appendFileSync(LOG_FILE, JSON.stringify(payload) + '\n')

  // Fire-and-forget. 800ms hard timeout. Failures are silent (no retries,
  // no queue, no offline buffering — telemetry must never block sverklo).
  try {
    await Promise.race([
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': `sverklo/${pkg.version}` },
        body: JSON.stringify(payload),
      }),
      new Promise((_, rej) => setTimeout(() => rej('timeout'), 800)),
    ])
  } catch { /* silent */ }
}
```

### Endpoint behavior pseudocode (Cloudflare Worker)

```ts
// telemetry-endpoint/index.ts
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method !== 'POST') return new Response('', { status: 405 })
    if (req.headers.get('content-type') !== 'application/json') return new Response('', { status: 415 })

    let body: unknown
    try { body = await req.json() } catch { return new Response('', { status: 400 }) }
    if (!isValidEvent(body)) return new Response('', { status: 400 })

    // Discard everything we don't need. Server adds ts.
    const sanitized = {
      install_id: body.install_id,
      version: body.version,
      os: body.os,
      node_major: body.node_major,
      event: body.event,
      tool: body.tool ?? null,
      outcome: body.outcome,
      duration_ms: body.duration_ms,
      ts: Math.floor(Date.now() / 1000),
    }

    // Append to a daily NDJSON file in R2/S3. No DB, no analytics service.
    await env.TELEMETRY_BUCKET.put(
      `${todayUTC()}/${crypto.randomUUID()}.json`,
      JSON.stringify(sanitized),
    )
    return new Response('', { status: 204 })
  },
}
```

The endpoint:
- Logs nothing else (no IP, no headers beyond what's verified).
- Has a 90-day retention lifecycle policy on the bucket. Older files auto-delete.
- Source is public in the same monorepo so anyone can audit.
- We commit to publishing the deployed Worker hash on every release so users can verify the running code matches the source.

### Where to call `track()` in sverklo

1. `bin/sverklo.ts init` → `track('init.run')` after init succeeds, plus `track('init.detected.claude-code')` for each detected client.
2. `bin/sverklo.ts doctor` → `track('doctor.run')` after each run; `track('doctor.issue')` for each fixable issue found (no detail).
3. `src/server/tools/*.ts` — add a wrapper in the dispatcher that calls `track('tool.call', { tool: name, outcome, duration_ms })`. Single insertion point so the per-tool files don't need to change.
4. `src/server/tools/remember.ts` → `track('memory.write')` (no content)
5. `src/server/tools/recall.ts` → `track('memory.read')` and `track('memory.staleness_detected')` if any returned memory was stale
6. `src/indexer/index.ts` first-run path → `track('index.cold_start', { duration_ms })`
7. MCP server keep-alive → `track('session.heartbeat')` at most once per hour

That's it. No other call sites. Future additions require a PR that touches `src/telemetry/types.ts` to add to the enum, which makes the diff visible.

---

## Cost & infra

- **Cloudflare Worker**: free tier handles 100k requests/day. We'll hit that ceiling if and only if the launch goes very well. Paid tier is $5/mo for 10M requests.
- **R2 bucket** (or Cloudflare KV / S3): 90-day retention, ~1KB per event. 100k events/day × 90 days × 1KB ≈ 9GB total. Free tier R2 storage is 10GB. Free.
- **Total**: $0–5/mo for the foreseeable future. Solo-dev cost.

---

## What we'll learn from the data we do collect

| Question | How the data answers it |
|---|---|
| How many people install sverklo? | Distinct `install_id` count per week |
| What % activate? | (distinct install_id with ≥1 `tool.call`) / (distinct install_id with `init.run`) within 24h |
| Day-7 retention? | install_id active in week 1 AND week 2 / week 1 |
| Tool diversity (NSM leading indicator) | distinct `tool` count per `install_id` per week |
| Most-used tool? | `tool.call` count grouped by `tool` |
| Memory adoption (stickiness moat) | install_id with ≥1 `memory.write` / total active |
| Are users hitting setup pain? | `doctor.issue` rate per `init.run` |
| Did the install-flow rewrite ship a real lift? | activation rate before vs after the release |
| Are tools failing in the wild? | `outcome=error` rate per tool |

Every one of these is computable from the nine-field schema. Nothing else is needed.

---

## What we will NOT learn (and that's fine)

- Whether sverklo's search results are good
- Whether memories are accurate
- What programming languages users work in
- Whether enterprise users vs hobbyists are using it
- How sverklo compares to grep on real codebases
- Anything tied to a specific repo

We learn those things from issues, Discord, Reddit replies, and direct outreach to opted-in users via the README CTA. Telemetry is for *how often the binary runs and which entry points get hit*, not *whether the product is good*.

---

## Open questions for Nikita

1. **Endpoint domain.** I've used `t.sverklo.com` in this doc — is that OK or do you want it under the apex (`sverklo.com/telemetry`)? Subdomain is cleaner because it lets us put the endpoint on a different host (CF Worker) without conflicting with Netlify routing.
2. **Event volume cap.** Should we cap events per install_id per day (say, 1000) to prevent runaway emission from a buggy version or a stuck loop? I'd say yes, with a `dropped` counter visible in the local log.
3. **Should we ever send `opt_in` and `opt_out` events?** They reveal *whether* a user opted in, which is itself a privacy signal. Tradeoff: without them we can't measure conversion to opt-in. I lean **no**, just count opt-ins by counting first events from a new install_id.
4. **R2 vs Plausible vs PostHog Cloud-EU.** R2 + custom queries is most defensible ("we host nothing, we wrote it"). Plausible/PostHog are easier but introduce a third party. I lean R2 for the brand, PostHog only if we want pretty dashboards immediately.
5. **Opt-in nudge.** Should `sverklo init` print a one-line "telemetry is OFF — you can enable with `sverklo telemetry enable` to help us prioritize" message? Or stay completely silent? Silent is safer; visible asks more but might feel pushy. I lean *one line, only on init, only once*.
6. **Retention.** 90 days is an arbitrary choice. Could be 30. Could be 180. What feels right given the launch cycle?
7. **Public dashboard.** Do we ever publish aggregated counts publicly (weekly active repos, % growth)? Would build trust. Risk: easier for competitors to model our growth. I lean publish *eventually*, maybe after 90 days when noise is averaged out.

---

## Decision needed before any code lands

Before I touch `src/`, I need a thumbs-up on:

- The 9-field schema as the entire surface (yes / no / "add field X")
- The 15-event enum (yes / no / "drop event Y")
- The opt-in UX text and command shape (`sverklo telemetry enable|disable|status|log`)
- Endpoint host choice (CF Worker on `t.sverklo.com` vs other)
- Whether the README gets a "Telemetry" section explaining all this (I think yes — preempts the HN comment)

Once those are decided, the implementation is one focused PR: ~250 lines across `src/telemetry/`, `bin/sverklo.ts`, the tool dispatcher, and `telemetry-endpoint/`. I can ship that in a single sitting after you sign off.

The risk of getting any of this wrong is reputational, not technical. The "no telemetry" sentence is in the README, the launch posts, the OG image tagline ("local-first"), and all five Reddit posts. If the implementation looks anything like a typical product analytics SDK, the launch dies on first sight. Erring toward "less data, more visible" is the only way through.

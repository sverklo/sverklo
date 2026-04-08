# Sverklo telemetry endpoint

The Cloudflare Worker that receives opt-in telemetry events from `sverklo` clients.

**Source code:** [`worker.ts`](./worker.ts) — under 200 lines, designed to be auditable in 60 seconds.

This endpoint exists because the alternative — shipping no telemetry at all — left every product decision blind. The full design is in [`../TELEMETRY_DESIGN.md`](../TELEMETRY_DESIGN.md). The user-facing summary is in [`../TELEMETRY.md`](../TELEMETRY.md). Read those before reading this.

---

## What it does

1. Accepts `POST /v1/event` with a JSON body matching the 9-field schema (validated explicitly)
2. Drops anything that doesn't match — extra fields, oversized strings, wrong enum values
3. Adds server-side `ts` (Unix seconds) — we never trust client clocks because they fingerprint machines
4. Writes the sanitized event as a single JSON file to an R2 bucket under `YYYY-MM-DD/<uuid>.json`
5. Returns `204 No Content`

It does **not** log:
- IP addresses (`X-Forwarded-For` is dropped)
- User-Agent beyond what's needed for content-type validation
- Cookies, sessions, or auth headers (none are accepted in the first place)
- Anything else from the request

---

## Validation rules (the entire whitelist)

| Field | Type | Allowed values |
|---|---|---|
| `install_id` | string | UUID v4 only (regex enforced) |
| `version` | string | ≤32 chars |
| `os` | string | `darwin` / `linux` / `win32` / `other` |
| `node_major` | int | 0–99 |
| `event` | string | one of 17 fixed enum values (see `ALLOWED_EVENTS`) |
| `tool` | string \| null | nullable; if string, must start with `sverklo_` and ≤64 chars |
| `outcome` | string | `ok` / `error` / `timeout` |
| `duration_ms` | int | 0–600,000 |

Anything else returns `400`. Anything that the client sent but isn't in the whitelist is dropped during the explicit reconstruction step in `worker.ts` even if validation passed — defense in depth.

---

## Storage

- **R2 bucket:** `sverklo-telemetry` (Cloudflare R2)
- **Key format:** `YYYY-MM-DD/<random-uuid>.json`
- **One event per object** — append-only, no contention, no DB
- **Lifecycle:** 90-day auto-delete (configured on the bucket via `wrangler r2 bucket lifecycle`)
- **Retention math:** ~1KB per event × 100k events/day × 90 days ≈ 9GB max — fits in R2 free tier (10GB)

---

## Deployment

### One-time setup

```bash
# 1. Install Wrangler if you haven't already
npm install -g wrangler

# 2. Authenticate
wrangler login

# 3. Create the R2 bucket
wrangler r2 bucket create sverklo-telemetry

# 4. Set the 90-day lifecycle policy
wrangler r2 bucket lifecycle add sverklo-telemetry \
  --id telemetry-90d \
  --prefix "" \
  --expire-days 90

# 5. Edit wrangler.toml — replace REPLACE_WITH_YOUR_CLOUDFLARE_ACCOUNT_ID
#    with the account ID shown in the Cloudflare dashboard sidebar.
```

### Deploy the worker

```bash
cd telemetry-endpoint
wrangler deploy
```

You should see something like:

```
Deployed sverklo-telemetry triggers (1.23 sec)
  https://t.sverklo.com/*
  https://sverklo-telemetry.<your-subdomain>.workers.dev
```

### DNS for `t.sverklo.com`

**If `sverklo.com` is on Cloudflare DNS:** the `[[routes]]` section in `wrangler.toml` handles it automatically — `wrangler deploy` registers the route.

**If `sverklo.com` is on Netlify DNS or another registrar:**

1. After `wrangler deploy` succeeds, copy the `<worker-name>.workers.dev` URL it printed
2. In your DNS manager, add a CNAME record:
   - Name: `t`
   - Value: `sverklo-telemetry.<your-subdomain>.workers.dev`
   - TTL: Auto
3. Wait ~5 minutes for DNS propagation
4. Verify: `curl -X POST https://t.sverklo.com/v1/event -H "content-type: application/json" -d '{}'` — should return `400 Invalid event` (which means the endpoint is reachable and validating)

### Updating

Any change to `worker.ts` is shipped with another `wrangler deploy`. The deployed Worker hash is published in every sverklo release so users can verify the running code matches the source.

---

## Reading the data

There is no admin dashboard. The bucket holds raw NDJSON. To compute weekly active repos, activation rate, etc., run a batch job locally:

```bash
# Pull last 7 days of events into a single NDJSON file
wrangler r2 object get sverklo-telemetry --recursive \
  --prefix "$(date -u -v-7d +%Y-%m-%d)" > week.ndjson

# Count distinct install_ids that emitted a tool.call
jq -s 'map(select(.event == "tool.call")) | group_by(.install_id) | length' week.ndjson
```

A small script that does this for the standard set of NSM queries lives at [`../scripts/telemetry-summary.sh`](../scripts/telemetry-summary.sh) (TODO).

---

## Public stats

After 90 days of data accumulated, an aggregated subset of these numbers will be published at `https://sverklo.com/stats`. Specifically:
- Weekly active repos (rolling 7-day count of distinct `install_id`s with ≥1 `tool.call`)
- Activation rate (% of new installs that issue ≥3 tool calls within 24h)
- Day-7 retention curve

No per-user data. No raw events. Just the same kind of numbers a privacy-respecting product transparency report would publish. Until then, the bucket is internal-only and the source for every aggregation lives in this repo.

---

## Audit invitation

Read `worker.ts` end-to-end. If anything in there surprises you, open an issue at https://github.com/sverklo/sverklo. The endpoint is intentionally tiny so this audit can take 60 seconds, not 60 minutes.

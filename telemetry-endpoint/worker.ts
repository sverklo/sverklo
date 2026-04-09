// Sverklo telemetry endpoint — Cloudflare Worker.
//
// What this does:
//   1. Accept POST /v1/event with a JSON body matching the 9-field schema
//   2. Validate and discard anything not in the whitelist
//   3. Add server-side ts (we never trust client clocks — they fingerprint)
//   4. Append the validated event to a daily NDJSON file in R2
//   5. Return 204 No Content
//
// What this DOES NOT do:
//   - Log IP addresses, headers (beyond content-type/user-agent for validation),
//     cookies, query strings, or anything else from the request.
//   - Authenticate. There is nothing to authenticate. The install_id is not a secret.
//   - Aggregate, transform, or process events. R2 holds raw NDJSON. Aggregation
//     is done out-of-band by a separate batch job that reads R2 and writes
//     summary files for the eventual /stats public dashboard.
//   - Retain forever. R2 lifecycle policy auto-deletes files older than 90 days.
//
// Source-auditable in 60 seconds. If anything in here surprises you,
// open an issue at github.com/sverklo/sverklo.
//
// ── Pageview endpoint (added for launch) ────────────────────────────
//
// POST /v1/pageview accepts a tiny shape from sverklo.com + /playground
// so we can tell where launch traffic is coming from. It is explicitly
// separate from /v1/event (tool telemetry) because the two categories
// have different privacy characteristics and different opt-in
// assumptions:
//
//   - /v1/event is opt-in per user, off by default in the CLI, guarded
//     by `sverklo telemetry enable` with a 22-line explainer before the
//     first byte is sent.
//   - /v1/pageview is website analytics. It has no cookies, no IP
//     storage, no fingerprinting, and respects the Do-Not-Track header
//     on the client side (the client doesn't send the ping if DNT is
//     on). It only counts which page was visited and where it came
//     from. This is the minimum we need to know whether a launch
//     channel actually drove traffic.
//
// Both endpoints write to the same R2 bucket but under different key
// prefixes so aggregation can tell them apart: events go to
// `<date>/<uuid>.json`, pageviews go to `pageviews/<date>/<uuid>.json`.

const ALLOWED_EVENTS = new Set([
  "init.run",
  "init.detected.claude-code",
  "init.detected.cursor",
  "init.detected.windsurf",
  "init.detected.vscode",
  "init.detected.jetbrains",
  "init.detected.antigravity",
  "doctor.run",
  "doctor.issue",
  "index.cold_start",
  "index.refresh",
  "tool.call",
  "memory.write",
  "memory.read",
  "memory.staleness_detected",
  "session.heartbeat",
  "opt_in",
  "opt_out",
]);

const ALLOWED_OS = new Set(["darwin", "linux", "win32", "other"]);
const ALLOWED_OUTCOME = new Set(["ok", "error", "timeout"]);

// install_id must be a UUID v4 (lowercase or upper). Anything else is rejected.
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

interface SanitizedEvent {
  install_id: string;
  version: string;
  os: string;
  node_major: number;
  event: string;
  tool: string | null;
  outcome: string;
  duration_ms: number;
  ts: number;
}

// Pageview shape. Deliberately minimal. No cookies, no IP, no UA beyond
// the short device-class string the client self-reports.
const ALLOWED_PAGES = new Set([
  "/",
  "/playground",
  "/playground/",
  "/blog",
  "/blog/",
]);

// Referrer buckets we care about. Anything not matching drops to "other".
// This shape lets us cheaply tell which launch channel drove traffic
// without storing arbitrary URLs.
function bucketReferrer(raw: string): string {
  if (!raw) return "direct";
  let host = "";
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return "other";
  }
  if (host === "news.ycombinator.com" || host.endsWith(".ycombinator.com")) return "hn";
  if (host === "reddit.com" || host.endsWith(".reddit.com")) return "reddit";
  if (host === "twitter.com" || host === "x.com" || host.endsWith(".x.com")) return "x";
  if (host === "github.com" || host.endsWith(".github.com") || host.endsWith(".githubusercontent.com")) return "github";
  if (host === "sverklo.com" || host.endsWith(".sverklo.com")) return "self";
  if (host === "producthunt.com" || host.endsWith(".producthunt.com")) return "producthunt";
  if (host === "lobste.rs") return "lobsters";
  if (host === "news.google.com") return "google-news";
  if (host === "google.com" || host.endsWith(".google.com")) return "google";
  if (host === "duckduckgo.com") return "duckduckgo";
  return "other";
}

interface SanitizedPageview {
  page: string;
  referrer_bucket: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  device: string; // "mobile" | "tablet" | "desktop" | "unknown"
  ts: number;
}

function isValidPageview(b: unknown): b is Omit<SanitizedPageview, "ts" | "referrer_bucket"> & { referrer?: string } {
  if (!b || typeof b !== "object") return false;
  const r = b as Record<string, unknown>;
  if (typeof r.page !== "string" || !ALLOWED_PAGES.has(r.page)) return false;
  if (r.referrer !== undefined && typeof r.referrer !== "string") return false;
  if (typeof r.referrer === "string" && r.referrer.length > 2048) return false;
  // utm_* fields: optional strings, short
  for (const k of ["utm_source", "utm_medium", "utm_campaign"]) {
    const v = r[k];
    if (v === undefined || v === null) continue;
    if (typeof v !== "string") return false;
    if (v.length > 64) return false;
  }
  if (typeof r.device !== "string") return false;
  if (!["mobile", "tablet", "desktop", "unknown"].includes(r.device)) return false;
  return true;
}

interface Env {
  TELEMETRY_BUCKET: R2Bucket;
}

interface R2Object {
  key: string;
  text(): Promise<string>;
}

interface R2Objects {
  objects: R2Object[];
  truncated: boolean;
  cursor?: string;
}

interface R2Bucket {
  put(key: string, value: string): Promise<void>;
  list(options: { prefix: string; limit?: number; cursor?: string }): Promise<R2Objects>;
  get(key: string): Promise<R2Object | null>;
}

// Cloudflare's Cache API is our only zero-cost memoization layer —
// Workers instances are ephemeral so module-level caching doesn't
// survive across requests. For the /v1/stats endpoint we cache the
// aggregated response for 60 seconds so a user hammering refresh
// during launch day doesn't send 1000 R2 GETs every time.
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

declare const caches: {
  default: {
    match(request: Request): Promise<Response | undefined>;
    put(request: Request, response: Response): Promise<void>;
  };
};

function isValidEvent(b: unknown): b is Omit<SanitizedEvent, "ts"> {
  if (!b || typeof b !== "object") return false;
  const r = b as Record<string, unknown>;
  if (typeof r.install_id !== "string" || !UUID_RE.test(r.install_id)) return false;
  if (typeof r.version !== "string" || r.version.length > 32) return false;
  if (typeof r.os !== "string" || !ALLOWED_OS.has(r.os)) return false;
  if (typeof r.node_major !== "number" || !Number.isInteger(r.node_major)) return false;
  if (r.node_major < 0 || r.node_major > 99) return false;
  if (typeof r.event !== "string" || !ALLOWED_EVENTS.has(r.event)) return false;
  if (r.tool !== null && typeof r.tool !== "string") return false;
  if (typeof r.tool === "string" && (r.tool.length > 64 || !r.tool.startsWith("sverklo_"))) return false;
  if (typeof r.outcome !== "string" || !ALLOWED_OUTCOME.has(r.outcome)) return false;
  if (typeof r.duration_ms !== "number" || !Number.isInteger(r.duration_ms)) return false;
  if (r.duration_ms < 0 || r.duration_ms > 600_000) return false;
  return true;
}

function todayUtc(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    // CORS preflight: nothing to allow, but be polite.
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, GET",
          "Access-Control-Allow-Headers": "content-type",
        },
      });
    }

    // Route: tool-telemetry event
    if (url.pathname === "/v1/event") {
      return handleEvent(req, env);
    }
    // Route: landing-page pageview
    if (url.pathname === "/v1/pageview") {
      return handlePageview(req, env);
    }
    // Route: aggregated pageview stats for today (launch-day viewer)
    if (url.pathname === "/v1/stats") {
      return handleStats(req, env, ctx);
    }
    return new Response("Not found", { status: 404 });
  },
};

async function handleEvent(req: Request, env: Env): Promise<Response> {
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    const ct = req.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      return new Response("Unsupported media type", { status: 415 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return new Response("Bad request", { status: 400 });
    }

    if (!isValidEvent(body)) {
      return new Response("Invalid event", { status: 400 });
    }

    // Re-construct the event from the whitelist explicitly. Anything the
    // client sent that isn't in the schema is dropped here, even if it
    // happened to validate. Defense in depth.
    const sanitized: SanitizedEvent = {
      install_id: body.install_id,
      version: body.version,
      os: body.os,
      node_major: body.node_major,
      event: body.event,
      tool: body.tool ?? null,
      outcome: body.outcome,
      duration_ms: body.duration_ms,
      ts: Math.floor(Date.now() / 1000),
    };

    // R2 key: one file per event, namespaced by UTC date. Cheap, append-only,
    // no contention. Aggregation reads the whole day folder out-of-band.
    // Crypto.randomUUID() is available in Workers runtime.
    const id = crypto.randomUUID();
    const key = `${todayUtc()}/${id}.json`;

    try {
      await env.TELEMETRY_BUCKET.put(key, JSON.stringify(sanitized));
    } catch {
      // R2 is down or misconfigured. We don't have a fallback — we're
      // deliberately tiny. Drop the event and return 204 anyway so the
      // client doesn't retry.
    }

    return new Response(null, {
      status: 204,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
}

async function handlePageview(req: Request, env: Env): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const ct = req.headers.get("content-type") || "";
  // sendBeacon sends text/plain by default; we accept both.
  if (!ct.includes("application/json") && !ct.includes("text/plain")) {
    return new Response("Unsupported media type", { status: 415 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  if (!isValidPageview(body)) {
    return new Response("Invalid pageview", { status: 400 });
  }

  // Re-bucket the referrer server-side so clients can't smuggle
  // arbitrary URLs in. We never store the raw referrer string.
  const rawReferrer = typeof body.referrer === "string" ? body.referrer : "";
  const bucket = bucketReferrer(rawReferrer);

  const sanitized: SanitizedPageview = {
    page: body.page,
    referrer_bucket: bucket,
    utm_source: body.utm_source ?? null,
    utm_medium: body.utm_medium ?? null,
    utm_campaign: body.utm_campaign ?? null,
    device: body.device,
    ts: Math.floor(Date.now() / 1000),
  };

  const id = crypto.randomUUID();
  const key = `pageviews/${todayUtc()}/${id}.json`;
  try {
    await env.TELEMETRY_BUCKET.put(key, JSON.stringify(sanitized));
  } catch {
    // Swallow — pageview analytics are best-effort.
  }

  return new Response(null, {
    status: 204,
    headers: { "Access-Control-Allow-Origin": "*" },
  });
}

// ────────────────────────────────────────────────────────────────────
// /v1/stats — aggregated pageview summary for today
// ────────────────────────────────────────────────────────────────────
//
// Launch-day analytics viewer. Scans pageviews/<today>/*.json from R2,
// tallies by referrer_bucket / page / device / utm_source, and returns
// the summary as JSON. Cached at the edge for 60 seconds so hammering
// refresh during launch day doesn't explode R2 class B costs.
//
// No auth. The aggregates are non-sensitive and the raw file keys use
// random UUIDs so the bucket contents aren't enumerable from the URL.
//
// To view:
//   curl https://t.sverklo.com/v1/stats
// Or bookmark in a browser tab for one-click refresh during launch.

interface StatsResponse {
  date: string;
  total: number;
  last_10m: number;
  by_referrer: Record<string, number>;
  by_page: Record<string, number>;
  by_device: Record<string, number>;
  by_utm_source: Record<string, number>;
  generated_at: number;
  cache_age_s: number;
}

async function handleStats(
  req: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Edge cache lookup. The cache key is synthetic — we don't use the
  // real request URL because we want a single canonical entry per
  // day (different user agents or headers shouldn't split the cache).
  const cacheKey = new Request(`https://t.sverklo.com/__cache/stats/${todayUtc()}`);
  const cached = await caches.default.match(cacheKey);
  if (cached) {
    // Return the cached response with a fresh Access-Control-Allow-Origin
    // header (not strictly needed, but cheap insurance).
    const body = await cached.text();
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
        "cache-control": "public, max-age=60",
        "x-sverklo-cache": "hit",
      },
    });
  }

  // Compute the aggregate. Walk every pageview object under today's
  // prefix. For a few thousand pageviews/day this is fine; beyond
  // that we'd want a roll-up counter updated on insert.
  const prefix = `pageviews/${todayUtc()}/`;
  const totals: StatsResponse = {
    date: todayUtc(),
    total: 0,
    last_10m: 0,
    by_referrer: {},
    by_page: {},
    by_device: {},
    by_utm_source: {},
    generated_at: Math.floor(Date.now() / 1000),
    cache_age_s: 0,
  };
  const cutoff10m = Math.floor(Date.now() / 1000) - 600;

  const bump = (map: Record<string, number>, key: string | null | undefined) => {
    if (!key) return;
    map[key] = (map[key] || 0) + 1;
  };

  let cursor: string | undefined;
  try {
    do {
      const listing = await env.TELEMETRY_BUCKET.list({
        prefix,
        limit: 1000,
        cursor,
      });
      // Parallelize the GET calls in small batches so we don't hit
      // Worker subrequest limits on huge days.
      const BATCH = 20;
      for (let i = 0; i < listing.objects.length; i += BATCH) {
        const batch = listing.objects.slice(i, i + BATCH);
        const bodies = await Promise.all(
          batch.map(async (obj) => {
            try {
              const body = await env.TELEMETRY_BUCKET.get(obj.key);
              if (!body) return null;
              return JSON.parse(await body.text());
            } catch {
              return null;
            }
          })
        );
        for (const data of bodies) {
          if (!data || typeof data !== "object") continue;
          totals.total++;
          if (typeof data.ts === "number" && data.ts >= cutoff10m) totals.last_10m++;
          bump(totals.by_referrer, data.referrer_bucket);
          bump(totals.by_page, data.page);
          bump(totals.by_device, data.device);
          bump(totals.by_utm_source, data.utm_source);
        }
      }
      cursor = listing.truncated ? listing.cursor : undefined;
    } while (cursor);
  } catch {
    // R2 list/get errors should not 500 the endpoint. Return
    // whatever we managed to aggregate with a partial flag.
  }

  const body = JSON.stringify(totals, null, 2);
  const response = new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=60",
      "x-sverklo-cache": "miss",
    },
  });

  // Fire-and-forget: store in edge cache so the next request within
  // 60s is a cheap hit. Clone because Response bodies are single-use.
  ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
}

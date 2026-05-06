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
  // Basic-auth password for /v1/stats and /v1/stats/ui.
  // Set via: wrangler secret put STATS_PASSWORD
  // Not in code, not in git. Unset = endpoints return 500.
  STATS_PASSWORD?: string;
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
    // Route: aggregated pageview stats for today (launch-day viewer).
    // Both the JSON endpoint and the HTML dashboard are behind HTTP
    // Basic Auth guarded by STATS_PASSWORD.
    if (url.pathname === "/v1/stats") {
      const authResult = checkBasicAuth(req, env);
      if (authResult) return authResult;
      return handleStats(req, env, ctx);
    }
    if (url.pathname === "/v1/stats/ui") {
      const authResult = checkBasicAuth(req, env);
      if (authResult) return authResult;
      return handleStatsUi();
    }
    // Route: aggregated CLI-event adoption stats. Same auth as /v1/stats.
    // Mirrors the pageview pipeline but reads root-level event keys
    // (init.run, init.detected.*, tool.call, etc.) instead of pageviews/.
    if (url.pathname === "/v1/adoption") {
      const authResult = checkBasicAuth(req, env);
      if (authResult) return authResult;
      return handleAdoptionStats(req, env, ctx);
    }
    if (url.pathname === "/v1/adoption/ui") {
      const authResult = checkBasicAuth(req, env);
      if (authResult) return authResult;
      return handleAdoptionUi();
    }
    // Route: publish badge grade
    if (url.pathname === "/v1/badge/publish") {
      return handleBadgePublish(req, env);
    }
    // Route: serve badge SVG
    const badgeMatch = url.pathname.match(/^\/v1\/badge\/([^/]+)\/([^/]+)\.svg$/);
    if (badgeMatch && req.method === "GET") {
      return handleBadgeSvg(badgeMatch[1], badgeMatch[2], env);
    }
    return new Response("Not found", { status: 404 });
  },
};

// ────────────────────────────────────────────────────────────────────
// HTTP Basic Auth guard for the stats endpoints
// ────────────────────────────────────────────────────────────────────
//
// Returns null if the request is authenticated, or a 401 Response if
// not. The expected password is read from env.STATS_PASSWORD which is
// stored as a Cloudflare Workers secret (not in code).
//
// Username is ignored — we only check the password. Browsers prompt
// once per session and remember the credentials for the duration of
// the browser session.

function checkBasicAuth(req: Request, env: Env): Response | null {
  if (!env.STATS_PASSWORD) {
    return new Response(
      "Stats endpoint is not configured: STATS_PASSWORD secret is unset. " +
        "Set it with: wrangler secret put STATS_PASSWORD",
      { status: 500 }
    );
  }
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Basic ")) {
    return new Response("Authentication required", {
      status: 401,
      headers: {
        "www-authenticate": 'Basic realm="sverklo-stats", charset="UTF-8"',
      },
    });
  }
  try {
    const decoded = atob(auth.slice(6));
    const colonIdx = decoded.indexOf(":");
    if (colonIdx < 0) {
      return new Response("Malformed credentials", { status: 401 });
    }
    const password = decoded.slice(colonIdx + 1);
    // Constant-time-ish comparison. Workers runtime doesn't give us
    // crypto.subtle for sync comparison, but the timing attack surface
    // is tiny here — it's a personal dashboard, not a login system.
    if (password !== env.STATS_PASSWORD) {
      return new Response("Invalid credentials", {
        status: 401,
        headers: {
          "www-authenticate": 'Basic realm="sverklo-stats", charset="UTF-8"',
        },
      });
    }
  } catch {
    return new Response("Malformed credentials", { status: 401 });
  }
  return null; // authenticated
}

// ────────────────────────────────────────────────────────────────────
// /v1/stats/ui — the HTML dashboard
// ────────────────────────────────────────────────────────────────────
//
// Minimal self-contained dashboard. Fetches /v1/stats every 15s and
// renders the aggregated numbers. Dark theme matching sverklo brand.
// No dependencies — vanilla JS, inline CSS, one file. ~200 lines.

function handleStatsUi(): Response {
  const html = STATS_UI_HTML;
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Same-origin only — we don't need this loaded from other sites.
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
    },
  });
}

const STATS_UI_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>sverklo stats</title>
<style>
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
html, body {
  background: #0E0D0B;
  color: #EDE7D9;
  font-family: ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace;
  font-size: 14px;
  line-height: 1.5;
  min-height: 100vh;
}
.wrap { max-width: 900px; margin: 0 auto; padding: 24px 16px; }
h1 {
  font-size: 14px;
  font-weight: 600;
  color: #E85A2A;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 4px;
}
.sub { color: #6B6354; font-size: 12px; margin-bottom: 24px; }
.hero {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 12px;
  margin-bottom: 24px;
}
@media (max-width: 600px) { .hero { grid-template-columns: 1fr; } }
.metric {
  background: #16140F;
  border: 1px solid #2A2620;
  border-radius: 8px;
  padding: 20px;
}
.metric .label {
  font-size: 11px;
  color: #6B6354;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 6px;
}
.metric .value {
  font-size: 36px;
  font-weight: 700;
  color: #EDE7D9;
  line-height: 1;
}
.metric .delta {
  font-size: 11px;
  color: #8FB339;
  margin-top: 4px;
}
.metric.accent { border-color: #E85A2A; }
.metric.accent .value { color: #E85A2A; }
section {
  background: #16140F;
  border: 1px solid #2A2620;
  border-radius: 8px;
  padding: 16px 20px;
  margin-bottom: 12px;
}
section h2 {
  font-size: 11px;
  font-weight: 600;
  color: #6B6354;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 12px;
}
.bar-row {
  display: grid;
  grid-template-columns: 100px 1fr 50px;
  gap: 12px;
  align-items: center;
  padding: 4px 0;
  font-size: 13px;
}
.bar-row .name { color: #A39886; text-transform: uppercase; font-size: 11px; letter-spacing: 0.04em; }
.bar-row .bar-track {
  height: 8px;
  background: #22201A;
  border-radius: 4px;
  overflow: hidden;
}
.bar-row .bar-fill {
  height: 100%;
  background: #E85A2A;
  transition: width 0.4s ease;
}
.bar-row .count { text-align: right; color: #EDE7D9; font-weight: 600; }
.bar-row.referrer .bar-fill { background: #E85A2A; }
.bar-row.page .bar-fill { background: #5BA3F5; }
.bar-row.device .bar-fill { background: #8FB339; }
.bar-row.utm .bar-fill { background: #D4A535; }
footer {
  color: #6B6354;
  font-size: 11px;
  text-align: center;
  margin-top: 24px;
  padding-top: 12px;
  border-top: 1px solid #22201A;
}
.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #8FB339;
  margin-right: 6px;
  animation: pulse 2s infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
.empty { color: #6B6354; font-style: italic; font-size: 12px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>sverklo · launch analytics</h1>
  <div class="sub" id="sub"><span class="dot"></span>connecting…</div>

  <div class="hero">
    <div class="metric accent">
      <div class="label">total today</div>
      <div class="value" id="m-total">—</div>
    </div>
    <div class="metric">
      <div class="label">last 10 min</div>
      <div class="value" id="m-last10">—</div>
    </div>
    <div class="metric">
      <div class="label">unique referrers</div>
      <div class="value" id="m-refcount">—</div>
    </div>
  </div>

  <section>
    <h2>by referrer</h2>
    <div id="s-referrer"><span class="empty">loading…</span></div>
  </section>

  <section>
    <h2>by page</h2>
    <div id="s-page"><span class="empty">loading…</span></div>
  </section>

  <section>
    <h2>by device</h2>
    <div id="s-device"><span class="empty">loading…</span></div>
  </section>

  <section>
    <h2>by utm source</h2>
    <div id="s-utm"><span class="empty">none yet</span></div>
  </section>

  <footer>
    Auto-refreshes every 15s · cache-max 60s<br>
    Data from t.sverklo.com/v1/stats · R2-backed · no cookies
  </footer>
</div>

<script>
let lastTotal = null;

async function fetchStats() {
  try {
    const r = await fetch('/v1/stats', { credentials: 'same-origin' });
    if (!r.ok) throw new Error(r.status);
    const data = await r.json();
    render(data);
  } catch (e) {
    document.getElementById('sub').innerHTML = '<span style="color:#E5484D">⚠ fetch failed: ' + e + '</span>';
  }
}

function renderBars(elId, obj, rowClass) {
  const el = document.getElementById(elId);
  const entries = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    el.innerHTML = '<span class="empty">none yet</span>';
    return;
  }
  const max = Math.max(...entries.map(([, v]) => v));
  el.innerHTML = entries.map(([name, count]) => {
    const pct = Math.max(2, Math.round((count / max) * 100));
    return '<div class="bar-row ' + rowClass + '">' +
           '<span class="name">' + escapeHtml(name) + '</span>' +
           '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div>' +
           '<span class="count">' + count + '</span>' +
           '</div>';
  }).join('');
}

function escapeHtml(s) {
  return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function render(data) {
  const delta = lastTotal !== null && data.total > lastTotal ? ' +' + (data.total - lastTotal) : '';
  document.getElementById('m-total').textContent = data.total;
  document.getElementById('m-last10').textContent = data.last_10m;
  document.getElementById('m-refcount').textContent = Object.keys(data.by_referrer || {}).length;
  document.getElementById('sub').innerHTML =
    '<span class="dot"></span>live · ' + data.date + ' · updated ' + new Date().toLocaleTimeString();

  renderBars('s-referrer', data.by_referrer, 'referrer');
  renderBars('s-page', data.by_page, 'page');
  renderBars('s-device', data.by_device, 'device');
  renderBars('s-utm', data.by_utm_source, 'utm');

  lastTotal = data.total;
}

fetchStats();
setInterval(fetchStats, 15000);
</script>
</body>
</html>`;

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

// ────────────────────────────────────────────────────────────────────
// Adoption Stats — aggregated CLI event analytics
// ────────────────────────────────────────────────────────────────────
//
// Mirrors the pageview /v1/stats pipeline but reads CLI events
// (`init.run`, `init.detected.*`, `tool.call`, etc.) stored at
// root-level `<utcDate>/<uuid>.json` instead of `pageviews/...`.
//
// What this answers that npm download counts can't:
//   - Of the daily npm pulls, how many actually run `sverklo init`?
//   - Which MCP client wins by adoption? (claude-code / cursor / windsurf / ...)
//   - Which sverklo version are users on (v0.20.1 vs v0.20.2 split)?
//   - Which OS dominates? (darwin / linux / win32)
//   - How many unique install_ids today? = unique users
//   - What tools do agents call most? (sverklo_search vs sverklo_lookup vs ...)
//   - How often do init runs fail? (outcome === "error")
//
// Auth: same HTTP Basic guard as /v1/stats, behind STATS_PASSWORD secret.
// Cache: 60s edge cache, same as the pageview path.
//
// Endpoints:
//   GET /v1/adoption        — JSON aggregate (machine-readable)
//   GET /v1/adoption/ui     — HTML dashboard (browser bookmark target)

interface AdoptionStatsResponse {
  /** Window covered by the aggregation. */
  days: number;
  /** Earliest UTC date scanned (inclusive). */
  from_date: string;
  /** Latest UTC date scanned (inclusive — usually today). */
  to_date: string;
  /** Convenience: most-recent date, mirrors `to_date`. Kept for backwards compat with v1 single-day clients. */
  date: string;
  total_events: number;
  unique_installs: number;
  last_10m_events: number;
  /** Per-day series so the dashboard can draw a sparkline / trend table. Keys are UTC dates. */
  daily: Record<string, { events: number; installs: number }>;
  by_event: Record<string, number>;
  by_client: Record<string, number>;
  by_version: Record<string, number>;
  by_os: Record<string, number>;
  by_tool: Record<string, number>;
  outcome: { ok: number; error: number; timeout: number };
  error_rate: number;
  init_completion_rate: number; // not currently observable until we add init.complete
  generated_at: number;
  cache_age_s: number;
}

/** Format a Date as YYYY-MM-DD in UTC. Same convention as todayUtc(). */
function utcDateString(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Return an array of YYYY-MM-DD strings covering the last `days` UTC days, oldest-first. */
function lastNUtcDates(days: number): string[] {
  const out: string[] = [];
  const today = new Date();
  for (let offset = days - 1; offset >= 0; offset--) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() - offset);
    out.push(utcDateString(d));
  }
  return out;
}

async function handleAdoptionStats(
  req: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Parse the time-window parameter. Default 1 day (today only). Capped
  // at 30 days to bound R2 listing/GET cost (worst case ~30 × 5K events
  // = 150K reads ≈ $0.06; cached at 60s so a busy dashboard refresh
  // doesn't multiply that). Anything outside [1, 30] is clamped silently.
  const url = new URL(req.url);
  const rawDays = parseInt(url.searchParams.get("days") || "1", 10);
  const days = Number.isNaN(rawDays) ? 1 : Math.max(1, Math.min(30, rawDays));

  // Cache key includes the window so 1-day and 7-day responses don't
  // collide. The today-portion of the cache key changes when UTC day
  // rolls over, naturally invalidating yesterday's cache.
  const cacheKey = new Request(
    `https://t.sverklo.com/__cache/adoption/${todayUtc()}/${days}`
  );
  const cached = await caches.default.match(cacheKey);
  if (cached) {
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

  // CLI events live at <utcDate>/<uuid>.json — root level, no nested
  // prefix like pageviews has. Listing with prefix "2026-05-05/" gets
  // CLI events; pageviews ("pageviews/2026-05-05/...") and badges
  // ("badges/...") have different prefixes so are excluded automatically.
  const dates = lastNUtcDates(days);
  const totals: AdoptionStatsResponse = {
    days,
    from_date: dates[0],
    to_date: dates[dates.length - 1],
    date: dates[dates.length - 1],
    total_events: 0,
    unique_installs: 0,
    last_10m_events: 0,
    daily: {},
    by_event: {},
    by_client: {},
    by_version: {},
    by_os: {},
    by_tool: {},
    outcome: { ok: 0, error: 0, timeout: 0 },
    error_rate: 0,
    init_completion_rate: 0,
    generated_at: Math.floor(Date.now() / 1000),
    cache_age_s: 0,
  };
  const cutoff10m = Math.floor(Date.now() / 1000) - 600;
  const installsAllTime = new Set<string>();
  const installsPerDay: Record<string, Set<string>> = {};
  for (const d of dates) {
    totals.daily[d] = { events: 0, installs: 0 };
    installsPerDay[d] = new Set<string>();
  }

  const bump = (map: Record<string, number>, key: string | null | undefined) => {
    if (!key) return;
    map[key] = (map[key] || 0) + 1;
  };

  // Iterate each date in the window and walk that date's R2 prefix.
  for (const date of dates) {
    const prefix = `${date}/`;
    let cursor: string | undefined;
    try {
      do {
        const listing = await env.TELEMETRY_BUCKET.list({
          prefix,
          limit: 1000,
          cursor,
        });
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
            totals.total_events++;
            totals.daily[date].events++;
            if (typeof data.ts === "number" && data.ts >= cutoff10m) totals.last_10m_events++;

            // install_id uniqueness — counts distinct machines in window + per-day
            if (typeof data.install_id === "string") {
              installsAllTime.add(data.install_id);
              installsPerDay[date].add(data.install_id);
            }

            if (typeof data.event === "string") {
              bump(totals.by_event, data.event);
              if (data.event.startsWith("init.detected.")) {
                const client = data.event.slice("init.detected.".length);
                bump(totals.by_client, client);
              }
            }

            if (typeof data.version === "string") bump(totals.by_version, data.version);
            if (typeof data.os === "string") bump(totals.by_os, data.os);

            if (data.event === "tool.call" && typeof data.tool === "string") {
              bump(totals.by_tool, data.tool);
            }

            if (
              typeof data.outcome === "string" &&
              (data.outcome === "ok" || data.outcome === "error" || data.outcome === "timeout")
            ) {
              totals.outcome[data.outcome]++;
            }
          }
        }
        cursor = listing.truncated ? listing.cursor : undefined;
      } while (cursor);
    } catch {
      // R2 listing/get errors should not 500. Return what we managed.
    }
  }

  totals.unique_installs = installsAllTime.size;
  for (const d of dates) {
    totals.daily[d].installs = installsPerDay[d].size;
  }
  const totalOutcome = totals.outcome.ok + totals.outcome.error + totals.outcome.timeout;
  totals.error_rate = totalOutcome === 0 ? 0 : totals.outcome.error / totalOutcome;

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

  ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
}

function handleAdoptionUi(): Response {
  return new Response(ADOPTION_UI_HTML, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
    },
  });
}

const ADOPTION_UI_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>sverklo adoption</title>
<style>
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
html, body {
  background: #0E0D0B;
  color: #EDE7D9;
  font-family: ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace;
  font-size: 14px;
  line-height: 1.5;
  min-height: 100vh;
}
.wrap { max-width: 900px; margin: 0 auto; padding: 24px 16px; }
h1 {
  font-size: 14px;
  font-weight: 600;
  color: #E85A2A;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 4px;
}
.sub { color: #6B6354; font-size: 12px; margin-bottom: 24px; }
.hero {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 24px;
}
@media (max-width: 700px) { .hero { grid-template-columns: 1fr 1fr; } }
@media (max-width: 480px) { .hero { grid-template-columns: 1fr; } }
.metric {
  background: #16140F;
  border: 1px solid #2A2620;
  border-radius: 8px;
  padding: 20px;
}
.metric .label {
  font-size: 11px;
  color: #6B6354;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 6px;
}
.metric .value {
  font-size: 28px;
  font-weight: 600;
  color: #EDE7D9;
}
.metric .value.small { font-size: 18px; }
section {
  background: #16140F;
  border: 1px solid #2A2620;
  border-radius: 8px;
  padding: 16px 20px;
  margin-bottom: 16px;
}
section h2 {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #6B6354;
  margin-bottom: 10px;
}
.bar-row {
  display: grid;
  grid-template-columns: 220px 1fr 60px;
  gap: 12px;
  align-items: center;
  padding: 4px 0;
  border-bottom: 1px solid #1F1C16;
}
.bar-row:last-child { border-bottom: none; }
.bar-row .name {
  font-size: 13px;
  color: #C0B9AC;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bar-row.client .name { color: #4c8cf7; }
.bar-row.event .name { color: #b487ff; }
.bar-row.tool .name { color: #4ade80; }
.bar-row.version .name { color: #facc15; }
.bar-row.os .name { color: #f59e0b; }
.bar-track {
  background: #2A2620;
  border-radius: 3px;
  height: 14px;
  overflow: hidden;
}
.bar-fill {
  background: #E85A2A;
  height: 100%;
  border-radius: 3px;
}
.bar-row.client .bar-fill { background: #4c8cf7; }
.bar-row.event .bar-fill { background: #b487ff; }
.bar-row.tool .bar-fill { background: #4ade80; }
.bar-row.version .bar-fill { background: #facc15; }
.bar-row.os .bar-fill { background: #f59e0b; }
.bar-row .count {
  font-variant-numeric: tabular-nums;
  text-align: right;
  color: #C0B9AC;
  font-size: 13px;
}
.empty { color: #4D463A; font-style: italic; }
.dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #4ade80;
  margin-right: 6px;
  vertical-align: middle;
}
footer {
  margin-top: 24px;
  font-size: 11px;
  color: #4D463A;
  line-height: 1.6;
}
footer a { color: #6B6354; text-decoration: none; }
footer a:hover { color: #E85A2A; }

/* Window selector — one row of buttons above the hero metrics. */
.window {
  display: flex;
  gap: 6px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.win-btn {
  background: #16140F;
  border: 1px solid #2A2620;
  color: #6B6354;
  padding: 6px 12px;
  border-radius: 6px;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  transition: color 0.1s, border-color 0.1s;
}
.win-btn:hover { color: #C0B9AC; border-color: #4D463A; }
.win-btn.active {
  background: #2A1812;
  border-color: #E85A2A;
  color: #E85A2A;
}

/* Daily trend table — one row per day, lightweight bar chart. */
.trend-row {
  display: grid;
  grid-template-columns: 100px 1fr 60px 60px;
  gap: 12px;
  align-items: center;
  padding: 4px 0;
  border-bottom: 1px solid #1F1C16;
  font-size: 13px;
}
.trend-row:last-child { border-bottom: none; }
.trend-row .date { color: #6B6354; font-variant-numeric: tabular-nums; }
.trend-row .events-count, .trend-row .installs-count {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: #C0B9AC;
}
.trend-row .installs-count { color: #4ade80; }
.trend-row .events-track {
  background: #2A2620;
  border-radius: 3px;
  height: 14px;
  overflow: hidden;
  position: relative;
}
.trend-row .events-fill {
  background: #E85A2A;
  height: 100%;
  border-radius: 3px;
}
.trend-row.zero .date { color: #4D463A; }
.trend-row.zero .events-count, .trend-row.zero .installs-count { color: #4D463A; }
.trend-header {
  display: grid;
  grid-template-columns: 100px 1fr 60px 60px;
  gap: 12px;
  padding: 4px 0 8px 0;
  font-size: 11px;
  color: #4D463A;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border-bottom: 1px solid #2A2620;
  margin-bottom: 4px;
}
.trend-header .events-h, .trend-header .installs-h {
  text-align: right;
}
</style>
</head>
<body>
<div class="wrap">
  <h1>sverklo adoption</h1>
  <p class="sub" id="sub">loading…</p>

  <div class="window">
    <button class="win-btn active" data-days="1" onclick="setWindow(1, this)">today</button>
    <button class="win-btn" data-days="7" onclick="setWindow(7, this)">7d</button>
    <button class="win-btn" data-days="14" onclick="setWindow(14, this)">14d</button>
    <button class="win-btn" data-days="30" onclick="setWindow(30, this)">30d</button>
  </div>

  <div class="hero">
    <div class="metric">
      <div class="label" id="lbl-installs">unique installs</div>
      <div class="value" id="m-installs">—</div>
    </div>
    <div class="metric">
      <div class="label" id="lbl-events">events</div>
      <div class="value" id="m-events">—</div>
    </div>
    <div class="metric">
      <div class="label">last 10m</div>
      <div class="value" id="m-last10">—</div>
    </div>
    <div class="metric">
      <div class="label">error rate</div>
      <div class="value small" id="m-errors">—</div>
    </div>
  </div>

  <section id="trend-section" style="display:none">
    <h2>daily trend</h2>
    <div id="s-trend"></div>
  </section>

  <section>
    <h2>by mcp client</h2>
    <div id="s-client"><span class="empty">loading…</span></div>
  </section>

  <section>
    <h2>by event type</h2>
    <div id="s-event"><span class="empty">loading…</span></div>
  </section>

  <section>
    <h2>by sverklo tool (tool.call events)</h2>
    <div id="s-tool"><span class="empty">no tool.call events yet</span></div>
  </section>

  <section>
    <h2>by sverklo version</h2>
    <div id="s-version"><span class="empty">loading…</span></div>
  </section>

  <section>
    <h2>by os</h2>
    <div id="s-os"><span class="empty">loading…</span></div>
  </section>

  <footer>
    Auto-refreshes every 15s · cache-max 60s<br>
    Data from t.sverklo.com/v1/adoption · R2-backed · CLI telemetry only (opt-in).<br>
    Companion to the <a href="/v1/stats/ui">pageview dashboard</a> at /v1/stats/ui.
  </footer>
</div>

<script>
let currentDays = 1;
let lastEvents = null;
let pollTimer = null;

function setWindow(days, btn) {
  currentDays = days;
  document.querySelectorAll('.win-btn').forEach(function (b) { b.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  // Re-fetch immediately and reset the auto-refresh cadence so the
  // user sees the new window right away.
  if (pollTimer) clearInterval(pollTimer);
  fetchStats();
  pollTimer = setInterval(fetchStats, 15000);
}

async function fetchStats() {
  try {
    const r = await fetch('/v1/adoption?days=' + currentDays, { credentials: 'same-origin' });
    if (!r.ok) throw new Error(r.status);
    const data = await r.json();
    render(data);
  } catch (e) {
    document.getElementById('sub').innerHTML = '<span style="color:#E5484D">⚠ fetch failed: ' + e + '</span>';
  }
}

function renderBars(elId, obj, rowClass) {
  const el = document.getElementById(elId);
  const entries = Object.entries(obj || {}).sort(function (a, b) { return b[1] - a[1]; });
  if (entries.length === 0) {
    el.innerHTML = '<span class="empty">none yet</span>';
    return;
  }
  const max = Math.max.apply(null, entries.map(function (e) { return e[1]; }));
  el.innerHTML = entries.map(function (entry) {
    const name = entry[0]; const count = entry[1];
    const pct = Math.max(2, Math.round((count / max) * 100));
    return '<div class="bar-row ' + rowClass + '">' +
           '<span class="name">' + escapeHtml(name) + '</span>' +
           '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div>' +
           '<span class="count">' + count + '</span>' +
           '</div>';
  }).join('');
}

function renderTrend(daily) {
  const section = document.getElementById('trend-section');
  const dates = Object.keys(daily || {}).sort();
  if (dates.length <= 1) {
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';
  const max = Math.max.apply(null, dates.map(function (d) { return daily[d].events; }));
  const headerHtml =
    '<div class="trend-header">' +
    '<span>date</span>' +
    '<span>events</span>' +
    '<span class="events-h">events</span>' +
    '<span class="installs-h">installs</span>' +
    '</div>';
  const rowsHtml = dates.map(function (d) {
    const row = daily[d];
    const pct = max === 0 ? 0 : Math.max(0, Math.round((row.events / max) * 100));
    const cls = row.events === 0 ? 'trend-row zero' : 'trend-row';
    return '<div class="' + cls + '">' +
           '<span class="date">' + d + '</span>' +
           '<div class="events-track"><div class="events-fill" style="width:' + pct + '%"></div></div>' +
           '<span class="events-count">' + row.events + '</span>' +
           '<span class="installs-count">' + row.installs + '</span>' +
           '</div>';
  }).join('');
  document.getElementById('s-trend').innerHTML = headerHtml + rowsHtml;
}

function escapeHtml(s) {
  return String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function render(data) {
  document.getElementById('m-installs').textContent = data.unique_installs;
  document.getElementById('m-events').textContent = data.total_events;
  document.getElementById('m-last10').textContent = data.last_10m_events;
  const errPct = data.error_rate ? (data.error_rate * 100).toFixed(1) + '%' : '0%';
  document.getElementById('m-errors').textContent = errPct;

  // Update labels to reflect window — "events today" vs "events (last 7d)".
  const installsLabel = data.days === 1 ? 'unique installs' : 'unique installs · ' + data.days + 'd';
  const eventsLabel = data.days === 1 ? 'events today' : 'events · ' + data.days + 'd';
  document.getElementById('lbl-installs').textContent = installsLabel;
  document.getElementById('lbl-events').textContent = eventsLabel;

  const windowLabel = data.days === 1
    ? data.to_date
    : data.from_date + ' → ' + data.to_date + ' (' + data.days + 'd)';
  document.getElementById('sub').innerHTML =
    '<span class="dot"></span>live · ' + windowLabel + ' · updated ' + new Date().toLocaleTimeString();

  renderTrend(data.daily);
  renderBars('s-client', data.by_client, 'client');
  renderBars('s-event', data.by_event, 'event');
  renderBars('s-tool', data.by_tool, 'tool');
  renderBars('s-version', data.by_version, 'version');
  renderBars('s-os', data.by_os, 'os');

  lastEvents = data.total_events;
}

fetchStats();
pollTimer = setInterval(fetchStats, 15000);
</script>
</body>
</html>`;

// ────────────────────────────────────────────────────────────────────
// Badge API — publish + serve health grade badges
// ────────────────────────────────────────────────────────────────────
//
// POST /v1/badge/publish — CLI sends audit grade for a repo.
// GET  /v1/badge/:owner/:repo.svg — returns an SVG badge with the grade.
//
// Grades are stored in R2 at badges/<owner>/<repo>.json.
// The badge is generated as inline SVG (no external dependency).

const VALID_GRADES = new Set(["A", "B", "C", "D", "F"]);
const GRADE_COLORS: Record<string, string> = {
  A: "#4c1",
  B: "#97ca00",
  C: "#dfb317",
  D: "#fe7d37",
  F: "#e05d44",
};

interface BadgeData {
  owner: string;
  repo: string;
  grade: string;
  dimensions: { name: string; grade: string; detail: string }[];
  version: string;
  ts: number;
}

function isValidBadgePublish(b: unknown): b is Omit<BadgeData, "ts"> {
  if (!b || typeof b !== "object") return false;
  const r = b as Record<string, unknown>;
  if (typeof r.owner !== "string" || r.owner.length < 1 || r.owner.length > 100) return false;
  if (typeof r.repo !== "string" || r.repo.length < 1 || r.repo.length > 100) return false;
  if (typeof r.grade !== "string" || !VALID_GRADES.has(r.grade)) return false;
  if (typeof r.version !== "string" || r.version.length > 32) return false;
  // owner/repo must be alphanumeric + hyphens + underscores + dots
  if (!/^[a-zA-Z0-9._-]+$/.test(r.owner)) return false;
  if (!/^[a-zA-Z0-9._-]+$/.test(r.repo)) return false;
  return true;
}

async function handleBadgePublish(req: Request, env: Env): Promise<Response> {
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

  if (!isValidBadgePublish(body)) {
    return new Response("Invalid badge data", { status: 400 });
  }

  const sanitized: BadgeData = {
    owner: body.owner.toLowerCase(),
    repo: body.repo.toLowerCase(),
    grade: body.grade,
    dimensions: Array.isArray(body.dimensions)
      ? (body.dimensions as { name: string; grade: string; detail: string }[])
          .slice(0, 10)
          .map((d) => ({
            name: String(d.name || "").slice(0, 50),
            grade: String(d.grade || "").slice(0, 2),
            detail: String(d.detail || "").slice(0, 200),
          }))
      : [],
    version: body.version,
    ts: Math.floor(Date.now() / 1000),
  };

  const key = `badges/${sanitized.owner}/${sanitized.repo}.json`;
  try {
    await env.TELEMETRY_BUCKET.put(key, JSON.stringify(sanitized));
  } catch {
    return new Response("Storage error", { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true, badge_url: `https://t.sverklo.com/v1/badge/${sanitized.owner}/${sanitized.repo}.svg` }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    },
  });
}

function makeBadgeSvg(grade: string): string {
  const color = GRADE_COLORS[grade] || "#9f9f9f";
  const labelWidth = 52;
  const valueWidth = 28;
  const totalWidth = labelWidth + valueWidth;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="sverklo: ${grade}">
  <title>sverklo: ${grade}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${totalWidth}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${color}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">
    <text aria-hidden="true" x="${labelWidth * 5 + 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(labelWidth - 10) * 10}">sverklo</text>
    <text x="${labelWidth * 5 + 10}" y="140" transform="scale(.1)" fill="#fff" textLength="${(labelWidth - 10) * 10}">sverklo</text>
    <text aria-hidden="true" x="${(labelWidth + valueWidth / 2) * 10 + 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(valueWidth - 10) * 10}">${grade}</text>
    <text x="${(labelWidth + valueWidth / 2) * 10 + 10}" y="140" transform="scale(.1)" fill="#fff" textLength="${(valueWidth - 10) * 10}">${grade}</text>
  </g>
</svg>`;
}

async function handleBadgeSvg(owner: string, repo: string, env: Env): Promise<Response> {
  const key = `badges/${owner.toLowerCase()}/${repo.toLowerCase()}.json`;
  let grade = "?";
  try {
    const obj = await env.TELEMETRY_BUCKET.get(key);
    if (obj) {
      const data = JSON.parse(await obj.text());
      if (data.grade && VALID_GRADES.has(data.grade)) {
        grade = data.grade;
      }
    }
  } catch {
    // Fall through with "?" grade
  }

  if (grade === "?") {
    // No audit published — return a "not audited" badge
    return new Response(
      `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="20" role="img" aria-label="sverklo: not audited">
  <title>sverklo: not audited</title>
  <clipPath id="r"><rect width="100" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="52" height="20" fill="#555"/>
    <rect x="52" width="48" height="20" fill="#9f9f9f"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">
    <text x="270" y="140" transform="scale(.1)" fill="#fff" textLength="420">sverklo</text>
    <text x="760" y="140" transform="scale(.1)" fill="#fff" textLength="380">n/a</text>
  </g>
</svg>`,
      {
        status: 200,
        headers: {
          "content-type": "image/svg+xml",
          "cache-control": "public, max-age=300",
          "access-control-allow-origin": "*",
        },
      }
    );
  }

  return new Response(makeBadgeSvg(grade), {
    status: 200,
    headers: {
      "content-type": "image/svg+xml",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
}

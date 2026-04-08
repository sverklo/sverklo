#!/usr/bin/env node
// Telemetry summary — read raw events from R2 and compute the launch metrics.
//
// Usage:
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node scripts/telemetry-summary.mjs [days]
//
// Default: 7 days. Pass an integer to look back further.
//
// Reads NDJSON files from the sverklo-telemetry R2 bucket via the Cloudflare
// API and computes:
//   - Weekly Active Indexed Repos (WAIR) — distinct install_id with >=1 tool.call in the window
//   - Activation rate — % of new install_ids that issued >=3 tool.call within 24h of init.run
//   - Day-7 retention — install_ids active in week 1 AND week 2 of their lifecycle
//   - Tool diversity — median distinct sverklo_* tools per install_id per week
//   - Memory write rate — % of active install_ids with >=1 memory.write
//   - Tool call breakdown — count by tool name (so we know which tools matter)
//   - Doctor issue rate — doctor.issue per init.run (setup pain proxy)
//   - Activation funnel — install_ids at each stage (init -> 1 call -> 3 calls -> day 7)
//
// Output format: human-readable table to stdout, plus a JSON line with all
// metrics for piping into other tools.

import { argv, env, exit } from "node:process";

const TOKEN = env.CLOUDFLARE_API_TOKEN;
const ACCOUNT_ID = env.CLOUDFLARE_ACCOUNT_ID;
const BUCKET = env.SVERKLO_TELEMETRY_BUCKET || "sverklo-telemetry";

if (!TOKEN || !ACCOUNT_ID) {
  console.error("error: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set");
  exit(1);
}

const days = parseInt(argv[2] || "7", 10);
if (!Number.isFinite(days) || days < 1) {
  console.error("error: days must be a positive integer");
  exit(1);
}

const API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}`;
const headers = { authorization: `Bearer ${TOKEN}` };

// ─── Pull events ────────────────────────────────────────────────

function utcDateStr(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const now = new Date();
const dateBuckets = [];
for (let i = 0; i < days; i++) {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - i);
  dateBuckets.push(utcDateStr(d));
}

console.error(`fetching ${days} days of events from R2 (${dateBuckets[dateBuckets.length - 1]} to ${dateBuckets[0]})...`);

async function fetchListPage(prefix, cursor) {
  const url = new URL(`${API}/objects`);
  url.searchParams.set("prefix", prefix);
  url.searchParams.set("per_page", "1000");
  if (cursor) url.searchParams.set("cursor", cursor);
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`R2 list failed: ${r.status} ${await r.text()}`);
  return r.json();
}

async function fetchAllKeysForDate(date) {
  const keys = [];
  let cursor = null;
  do {
    const page = await fetchListPage(`${date}/`, cursor);
    if (page.result) {
      for (const o of page.result) keys.push(o.key);
    }
    cursor = page.result_info?.cursor || null;
  } while (cursor);
  return keys;
}

async function fetchEvent(key) {
  const r = await fetch(`${API}/objects/${encodeURIComponent(key)}`, { headers });
  if (!r.ok) return null;
  try {
    return JSON.parse(await r.text());
  } catch {
    return null;
  }
}

// Fan out by date in parallel; fetch events sequentially per date to avoid
// hammering the API.
const allEvents = [];
for (const date of dateBuckets) {
  const keys = await fetchAllKeysForDate(date);
  console.error(`  ${date}: ${keys.length} events`);
  // Fetch in batches of 20 in parallel
  for (let i = 0; i < keys.length; i += 20) {
    const batch = keys.slice(i, i + 20);
    const events = await Promise.all(batch.map(fetchEvent));
    for (const e of events) if (e) allEvents.push(e);
  }
}

if (allEvents.length === 0) {
  console.error("\nno events in window — telemetry pipeline is healthy but nobody has opted in yet, or all opt-ins are outside the window.");
  console.log(JSON.stringify({ window_days: days, events: 0 }));
  exit(0);
}

console.error(`\nloaded ${allEvents.length} events. computing metrics...\n`);

// ─── Compute metrics ───────────────────────────────────────────

// Per-install_id index
const byInstall = new Map();
for (const e of allEvents) {
  if (!byInstall.has(e.install_id)) {
    byInstall.set(e.install_id, []);
  }
  byInstall.get(e.install_id).push(e);
}

// Sort each install's events by ts
for (const events of byInstall.values()) {
  events.sort((a, b) => a.ts - b.ts);
}

const installIds = [...byInstall.keys()];
const totalInstalls = installIds.length;

// WAIR — distinct install_id with >=1 tool.call in the window
const wair = installIds.filter((id) =>
  byInstall.get(id).some((e) => e.event === "tool.call")
).length;

// Activation rate — install_ids that issued >=3 tool.calls within 24h of their init.run
let activated = 0;
let initSeen = 0;
for (const id of installIds) {
  const events = byInstall.get(id);
  const init = events.find((e) => e.event === "init.run");
  if (!init) continue;
  initSeen++;
  const window = init.ts + 86400; // 24h
  const callCount = events.filter(
    (e) => e.event === "tool.call" && e.ts <= window
  ).length;
  if (callCount >= 3) activated++;
}
const activationRate = initSeen > 0 ? activated / initSeen : null;

// Day-7 retention — install_ids active in their first day AND active 7+ days later
let retainedD7 = 0;
let cohortD7 = 0;
for (const id of installIds) {
  const events = byInstall.get(id);
  if (events.length === 0) continue;
  const first = events[0].ts;
  const cohortEnd = first + 86400;
  const d7Start = first + 6 * 86400;
  const d7End = first + 8 * 86400;
  const wasActiveDay1 = events.some(
    (e) => e.event === "tool.call" && e.ts >= first && e.ts <= cohortEnd
  );
  if (!wasActiveDay1) continue;
  cohortD7++;
  const stillActive = events.some(
    (e) => e.event === "tool.call" && e.ts >= d7Start && e.ts <= d7End
  );
  if (stillActive) retainedD7++;
}
const day7Retention = cohortD7 > 0 ? retainedD7 / cohortD7 : null;

// Tool diversity — median distinct sverklo_* tools per install_id
const toolCounts = installIds.map((id) => {
  const events = byInstall.get(id);
  const tools = new Set(
    events
      .filter((e) => e.event === "tool.call" && e.tool)
      .map((e) => e.tool)
  );
  return tools.size;
});
toolCounts.sort((a, b) => a - b);
const medianToolDiversity =
  toolCounts.length > 0 ? toolCounts[Math.floor(toolCounts.length / 2)] : 0;

// Memory write rate — % of installs with >=1 memory.write among active installs
const activeWithMemory = installIds.filter((id) => {
  const events = byInstall.get(id);
  const isActive = events.some((e) => e.event === "tool.call");
  if (!isActive) return false;
  return events.some((e) => e.event === "memory.write");
}).length;
const memoryWriteRate = wair > 0 ? activeWithMemory / wair : null;

// Tool call breakdown
const toolCallBreakdown = new Map();
for (const e of allEvents) {
  if (e.event === "tool.call" && e.tool) {
    toolCallBreakdown.set(e.tool, (toolCallBreakdown.get(e.tool) || 0) + 1);
  }
}
const toolBreakdownSorted = [...toolCallBreakdown.entries()].sort((a, b) => b[1] - a[1]);

// Doctor issue rate
const doctorRuns = allEvents.filter((e) => e.event === "doctor.run").length;
const doctorIssues = allEvents.filter((e) => e.event === "doctor.issue").length;
const doctorIssueRate = doctorRuns > 0 ? doctorIssues / doctorRuns : null;

// Cold index avg
const coldIndexEvents = allEvents.filter(
  (e) => e.event === "index.cold_start" && e.duration_ms > 0
);
const avgColdIndexMs =
  coldIndexEvents.length > 0
    ? Math.round(
        coldIndexEvents.reduce((s, e) => s + e.duration_ms, 0) /
          coldIndexEvents.length
      )
    : null;

// Activation funnel
const stage_init = installIds.filter((id) =>
  byInstall.get(id).some((e) => e.event === "init.run")
).length;
const stage_first_call = wair;
const stage_three_calls = installIds.filter((id) => {
  const calls = byInstall.get(id).filter((e) => e.event === "tool.call");
  return calls.length >= 3;
}).length;
const stage_memory_write = installIds.filter((id) =>
  byInstall.get(id).some((e) => e.event === "memory.write")
).length;

// ─── Print report ───────────────────────────────────────────────

const fmtPct = (v) => (v == null ? "n/a" : `${(v * 100).toFixed(1)}%`);
const fmtMs = (v) => (v == null ? "n/a" : `${v} ms`);

console.log("━".repeat(60));
console.log(`SVERKLO TELEMETRY — last ${days} days (${dateBuckets[dateBuckets.length - 1]} → ${dateBuckets[0]})`);
console.log("━".repeat(60));
console.log("");
console.log("HEADLINE METRICS");
console.log("───────────────");
console.log(`  Total events:            ${allEvents.length}`);
console.log(`  Distinct install_ids:    ${totalInstalls}`);
console.log(`  WAIR (active repos):     ${wair}`);
console.log(`  Activation rate:         ${fmtPct(activationRate)}  (${activated}/${initSeen} installs hit ≥3 calls within 24h)`);
console.log(`  Day-7 retention:         ${fmtPct(day7Retention)}  (${retainedD7}/${cohortD7} cohort)`);
console.log(`  Median tool diversity:   ${medianToolDiversity}  (distinct sverklo_* tools per install/week)`);
console.log(`  Memory write rate:       ${fmtPct(memoryWriteRate)}  (${activeWithMemory}/${wair} active installs ever called sverklo_remember)`);
console.log("");
console.log("ACTIVATION FUNNEL");
console.log("─────────────────");
console.log(`  init.run:           ${stage_init}`);
console.log(`  ≥1 tool.call:       ${stage_first_call}  (${stage_init > 0 ? ((stage_first_call / stage_init) * 100).toFixed(0) + "%" : "n/a"})`);
console.log(`  ≥3 tool.call:       ${stage_three_calls}  (${stage_init > 0 ? ((stage_three_calls / stage_init) * 100).toFixed(0) + "%" : "n/a"})`);
console.log(`  memory.write:       ${stage_memory_write}  (${stage_init > 0 ? ((stage_memory_write / stage_init) * 100).toFixed(0) + "%" : "n/a"})`);
console.log("");
console.log("INDEXING");
console.log("────────");
console.log(`  Cold index runs:    ${coldIndexEvents.length}`);
console.log(`  Avg cold duration:  ${fmtMs(avgColdIndexMs)}`);
console.log(`  Doctor runs:        ${doctorRuns}`);
console.log(`  Doctor issues:      ${doctorIssues}  (${fmtPct(doctorIssueRate)} of runs find a fix)`);
console.log("");
console.log("TOOL CALL BREAKDOWN (top 20)");
console.log("────────────────────────────");
for (const [tool, count] of toolBreakdownSorted.slice(0, 20)) {
  console.log(`  ${tool.padEnd(28)}  ${count}`);
}
console.log("");
console.log("━".repeat(60));
console.log("MACHINE-READABLE");
console.log("━".repeat(60));
console.log(
  JSON.stringify({
    window_days: days,
    window_start: dateBuckets[dateBuckets.length - 1],
    window_end: dateBuckets[0],
    events_total: allEvents.length,
    distinct_installs: totalInstalls,
    wair,
    activation_rate: activationRate,
    activation_count: activated,
    activation_cohort: initSeen,
    day7_retention: day7Retention,
    day7_retained: retainedD7,
    day7_cohort: cohortD7,
    median_tool_diversity: medianToolDiversity,
    memory_write_rate: memoryWriteRate,
    cold_index_runs: coldIndexEvents.length,
    avg_cold_index_ms: avgColdIndexMs,
    doctor_runs: doctorRuns,
    doctor_issues: doctorIssues,
    doctor_issue_rate: doctorIssueRate,
    tool_call_breakdown: Object.fromEntries(toolBreakdownSorted),
  })
);
